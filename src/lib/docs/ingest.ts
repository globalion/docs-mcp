// Ingest pipeline: raw upload → vector chunks in Postgres.
//
//   1. Write raw bytes to /data/docs/<userId>/<docId>/original.<ext>
//   2. Convert to per-page PNGs (LibreOffice + pdftoppm)
//   3. Deduct credits = pageCount (compare-and-swap, refund on failure)
//   4. For each page (concurrency-bounded): vision extract → chunk → embed
//   5. Insert chunks with vector column via $queryRawUnsafe (Prisma can't
//      express `vector(1536)` in its type-safe API)
//   6. Mark document ready
//
// Runs as fire-and-forget from /api/upload. Status updates on the Document
// row let the dashboard + docs_get show progress; failures set status='failed'
// with errorMsg and refund the deducted credits.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db";
import { tryDeduct, refund, quoteCredits } from "../credits";
import { isAdminUser } from "../admin";
import { documentToPagePngs, extForMime } from "./convert";
import { extractPageFromImage } from "./vision";
import { embedBatch } from "./embed";
import { chunkPageText } from "./chunk";

const DATA_ROOT = process.env.DOCS_DATA_ROOT ?? "/data/docs";

// Vision calls are the bottleneck. 4 concurrent per doc = happy path stays
// under 30s for a 12-page doc, while keeping OpenRouter rate-limit exposure
// per-doc rather than fleet-wide.
const VISION_CONCURRENCY = 4;

interface CreateArgs {
  userId: string;
  filename: string;
  mimeType: string;
  sha256Hex: string;
  bytes: Buffer;
}

/** Create the Document row + persist bytes to disk. Idempotent by (user, sha256). */
export async function createDocumentRow(args: CreateArgs) {
  const existing = await prisma.document.findUnique({
    where: { userId_sha256: { userId: args.userId, sha256: args.sha256Hex } },
  });
  if (existing) return { doc: existing, isNew: false };

  const doc = await prisma.document.create({
    data: {
      userId: args.userId,
      filename: args.filename,
      mimeType: args.mimeType,
      sha256: args.sha256Hex,
      bytes: args.bytes.length,
      storagePath: "", // filled in below
      status: "pending",
    },
  });

  const dir = path.join(DATA_ROOT, args.userId, doc.id);
  await mkdir(dir, { recursive: true });
  const storagePath = path.join(dir, `original${extForMime(args.mimeType)}`);
  await writeFile(storagePath, args.bytes);

  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: { storagePath },
  });
  return { doc: updated, isNew: true };
}

/**
 * Runs the full ingest for a Document that's in state 'pending'. Marks
 * 'processing' → 'ready' | 'failed'. Deducts credits ONCE we know pageCount;
 * refunds on failure.
 */
export async function runIngest(docId: string): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: docId } });
  if (!doc) throw new Error(`document ${docId} not found`);
  if (doc.status !== "pending") return; // idempotent

  await prisma.document.update({
    where: { id: docId },
    data: { status: "processing", errorMsg: null },
  });

  let creditsCharged = 0;
  try {
    // Convert to per-page images (any office format → pdf → pngs).
    const { pagePaths } = await documentToPagePngs(doc.storagePath, doc.mimeType);
    const pageCount = pagePaths.length;

    // Deduct credits — one per page. Admins bypass the balance check but
    // still get a ledger entry for auditability.
    const admin = await isAdminUser(doc.userId);
    const cost = quoteCredits(pageCount).totalCredits;
    if (!admin) {
      const newBal = await tryDeduct(doc.userId, cost, "ingest", docId);
      if (newBal === null) {
        throw new Error(`insufficient credits: need ${cost}, top up at /dashboard`);
      }
      creditsCharged = cost;
    } else {
      await prisma.creditTransaction.create({
        data: { userId: doc.userId, delta: 0, reason: "admin_grant", docId, metadata: { pages: pageCount } },
      });
    }

    // Vision extract every page, bounded concurrency.
    const pageTexts: string[] = new Array(pageCount).fill("");
    for (let i = 0; i < pageCount; i += VISION_CONCURRENCY) {
      const batch = pagePaths.slice(i, i + VISION_CONCURRENCY);
      const results = await Promise.all(
        batch.map((p, idxInBatch) => extractPageFromImage(p).then((r) => ({ idx: i + idxInBatch, r }))),
      );
      for (const { idx, r } of results) pageTexts[idx] = r.text;
    }

    // Chunk each page's text; keep (chunk, pageNumber) pairs so citations
    // resolve to the exact page later.
    interface ChunkWithMeta {
      pageNumber: number;
      chunkIndex: number;
      content: string;
      tokenCount: number;
    }
    const chunks: ChunkWithMeta[] = [];
    let cursor = 0;
    for (let p = 0; p < pageCount; p++) {
      const pieces = chunkPageText(pageTexts[p]);
      for (const piece of pieces) {
        chunks.push({
          pageNumber: p + 1,
          chunkIndex: cursor++,
          content: piece.content,
          tokenCount: piece.tokenCount,
        });
      }
    }

    if (chunks.length === 0) {
      // A doc with no extractable text still counts as processed — just no
      // retrievable chunks. Common for entirely-blank scans.
      await prisma.document.update({
        where: { id: docId },
        data: { status: "ready", pageCount, creditsSpent: creditsCharged },
      });
      return;
    }

    // Embed everything in batches (embedBatch handles internal batching).
    const vectors = await embedBatch(chunks.map((c) => c.content));

    // Insert with raw SQL because Prisma has no type for vector(1536).
    // Batch INSERT to avoid one round-trip per chunk.
    const INSERT_BATCH = 32;
    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      const slice = chunks.slice(i, i + INSERT_BATCH);
      const vecSlice = vectors.slice(i, i + INSERT_BATCH);
      const rows = slice
        .map((c, j) => {
          const v = `[${vecSlice[j].join(",")}]`;
          // Escape content: replace ' with '' for Postgres string literal.
          const safeContent = c.content.replace(/'/g, "''");
          return `('c${docId.slice(-8)}${c.chunkIndex}', '${docId}', ${c.chunkIndex}, ${c.pageNumber}, '${safeContent}', ${c.tokenCount}, '${v}'::vector, now())`;
        })
        .join(",\n");
      await prisma.$executeRawUnsafe(
        `INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", "pageNumber", content, "tokenCount", embedding, "createdAt") VALUES ${rows}`,
      );
    }

    await prisma.document.update({
      where: { id: docId },
      data: {
        status: "ready",
        pageCount,
        creditsSpent: creditsCharged,
      },
    });
  } catch (err) {
    // Refund what we charged before we blew up.
    if (creditsCharged > 0) {
      await refund(doc.userId, creditsCharged, docId);
    }
    await prisma.document.update({
      where: { id: docId },
      data: {
        status: "failed",
        errorMsg: (err as Error).message.slice(0, 500),
      },
    });
    throw err;
  }
}
