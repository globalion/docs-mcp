// Ingest pipeline: raw upload → vector chunks in Postgres.
//
// Split into two phases so the user sees the cost BEFORE credits get debited:
//
//   Phase 1 (runIngest):
//     • Write bytes → convert (LibreOffice + pdftoppm) → count pages
//     • Check balance vs cost
//     • If balance covers it → deduct, then Phase 2
//     • If NOT → set status="needs_credits" with a clear "top up N pages"
//       message. No vision runs, no credits debited. User can top up then
//       hit POST /api/docs/:id/retry to resume from this point.
//
//   Phase 2 (runVisionAndEmbed):
//     • Vision extract every page (4 concurrent)
//     • Chunk + embed
//     • Insert chunks with vector column
//     • Set status="ready"
//     • On any failure, refund the credits we debited and status="failed"
//
// LibreOffice conversion is cached on disk — retry after top-up doesn't
// re-convert, it just re-reads the page-*.png files that already exist.

import { mkdir, readdir, unlink, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db";
import { tryDeduct, refund, quoteCredits, readBalance } from "../credits";
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
      storagePath: "",
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
 * Return page PNG paths, reusing what's on disk if a prior run already
 * converted the doc. Retry-after-topup path relies on this — we don't want
 * to burn LibreOffice CPU twice.
 */
async function ensurePagesConverted(storagePath: string, mimeType: string): Promise<string[]> {
  const dir = path.dirname(storagePath);
  const existing = await readdir(dir).catch(() => [] as string[]);
  const cached = existing
    .filter((f) => /^page-\d+\.png$/.test(f))
    .map((f) => ({ name: f, num: parseInt(f.match(/^page-(\d+)\.png$/)![1], 10) }))
    .sort((a, b) => a.num - b.num)
    .map((f) => path.join(dir, f.name));
  if (cached.length > 0) return cached;
  const { pagePaths } = await documentToPagePngs(storagePath, mimeType);
  return pagePaths;
}

/**
 * Phase 1 orchestrator. Called fire-and-forget from /api/upload and from the
 * MCP docs_upload tool. Idempotent on retry — safe to invoke again after a
 * `needs_credits` result once the user has topped up.
 */
export async function runIngest(docId: string): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: docId } });
  if (!doc) throw new Error(`document ${docId} not found`);
  if (doc.status === "ready" || doc.status === "processing") return;

  await prisma.document.update({
    where: { id: docId },
    data: { status: "processing", errorMsg: null },
  });

  try {
    // Convert (or re-use cached pages from a prior attempt).
    const pagePaths = await ensurePagesConverted(doc.storagePath, doc.mimeType);
    const pageCount = pagePaths.length;
    await prisma.document.update({
      where: { id: docId },
      data: { pageCount },
    });

    // Cost check. Admins bypass.
    const admin = await isAdminUser(doc.userId);
    const cost = quoteCredits(pageCount).totalCredits;
    let creditsCharged = 0;

    if (!admin) {
      const balance = await readBalance(doc.userId);
      if (balance < cost) {
        // Hold here. No vision, no debit. User can top up + retry.
        await prisma.document.update({
          where: { id: docId },
          data: {
            status: "needs_credits",
            errorMsg: `This document is ${pageCount} pages and needs ${cost} credits. You have ${balance}. Top up + click Retry.`,
          },
        });
        return;
      }
      const newBal = await tryDeduct(doc.userId, cost, "ingest", docId);
      if (newBal === null) {
        // Race: another concurrent operation drained credits between our
        // check and this deduction. Treat as needs_credits.
        await prisma.document.update({
          where: { id: docId },
          data: {
            status: "needs_credits",
            errorMsg: `Balance dropped mid-processing. Top up + click Retry.`,
          },
        });
        return;
      }
      creditsCharged = cost;
    } else {
      await prisma.creditTransaction.create({
        data: {
          userId: doc.userId,
          delta: 0,
          reason: "admin_grant",
          docId,
          metadata: { pages: pageCount },
        },
      });
    }

    // Phase 2 — expensive.
    await runVisionAndEmbed(docId, pagePaths, creditsCharged);
  } catch (err) {
    // Only fires for pre-vision errors (LibreOffice, poppler). Post-vision
    // failures are handled inside runVisionAndEmbed which refunds itself.
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

/**
 * Phase 2. Runs vision extraction, chunking, and embedding. On failure,
 * refunds `creditsCharged`. `pagePaths` comes from Phase 1.
 */
async function runVisionAndEmbed(
  docId: string,
  pagePaths: string[],
  creditsCharged: number,
): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: docId } });
  if (!doc) throw new Error(`document ${docId} vanished mid-ingest`);

  try {
    const pageCount = pagePaths.length;
    const pageTexts: string[] = new Array(pageCount).fill("");
    for (let i = 0; i < pageCount; i += VISION_CONCURRENCY) {
      const batch = pagePaths.slice(i, i + VISION_CONCURRENCY);
      const results = await Promise.all(
        batch.map((p, idxInBatch) =>
          extractPageFromImage(p).then((r) => ({ idx: i + idxInBatch, r })),
        ),
      );
      for (const { idx, r } of results) pageTexts[idx] = r.text;
    }

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
      // Blank doc — no chunks to embed. Still counts as ready.
      await prisma.document.update({
        where: { id: docId },
        data: { status: "ready", creditsSpent: creditsCharged },
      });
      return;
    }

    const vectors = await embedBatch(chunks.map((c) => c.content));

    // Delete any leftover chunks from a prior partial attempt before inserting
    // fresh ones (retry safety). Cheap when the count is 0.
    await prisma.documentChunk.deleteMany({ where: { documentId: docId } });

    const INSERT_BATCH = 32;
    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      const slice = chunks.slice(i, i + INSERT_BATCH);
      const vecSlice = vectors.slice(i, i + INSERT_BATCH);
      const rows = slice
        .map((c, j) => {
          const v = `[${vecSlice[j].join(",")}]`;
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
      data: { status: "ready", creditsSpent: creditsCharged },
    });
  } catch (err) {
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

/**
 * Delete raw files on disk when a document is removed. Called from the API
 * layer AFTER the Prisma delete succeeds. Best-effort — failures logged, not
 * rethrown (the row is already gone, cleanup is nice-to-have).
 */
export async function purgeDocumentFiles(userId: string, docId: string): Promise<void> {
  const dir = path.join(DATA_ROOT, userId, docId);
  try {
    const files = await readdir(dir).catch(() => [] as string[]);
    for (const f of files) {
      await unlink(path.join(dir, f)).catch(() => undefined);
    }
    await rmdir(dir).catch(() => undefined);
  } catch (err) {
    console.error(`[ingest] purge files for ${docId} failed:`, err);
  }
}
