// POST /api/upload — multipart file upload for the web dashboard AND direct
// programmatic uploads authed by API key.
//
// Auth: session cookie (dashboard drag & drop) OR Bearer API key (curl / MCP
// wrapper). Reads the file, dedupes on sha256, writes to disk, kicks async
// ingest, returns docId.
//
// Rate limit: 60 uploads/hour per API key (bearer path). Dashboard uploads
// use a session cookie and are not rate-limited here — the dashboard's own
// UX prevents abuse. This protects docs-mcp from a leaked key that starts
// looping uploads to burn its owner's credit balance.
//
// Size cap: 50 MB per file. MCP tool caps smaller (~7 MB raw) because
// base64 inflates JSON payloads.

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";
import { findLiveKey } from "@/lib/keys";
import { createDocumentRow, runIngest } from "@/lib/docs/ingest";
import { ALLOWED_MIME_TYPES } from "@/lib/docs/convert";
import { checkRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024;
const UPLOAD_LIMIT_PER_HOUR = 60;
const HOUR_MS = 60 * 60 * 1000;

export async function POST(req: Request) {
  let userId: string | null = null;
  let rateKey: string | null = null;

  const session = await auth().catch(() => null);
  if (session?.user?.id) {
    userId = session.user.id;
    // Sessions are trusted (user is signed in on the web UI). No rate limit.
  } else {
    const authHeader = req.headers.get("authorization") || "";
    const raw = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (raw) {
      const key = await findLiveKey(raw);
      if (key) {
        userId = key.userId;
        rateKey = key.keyPrefix; // use prefix (not raw) as the bucket id
      }
    }
  }
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Rate limit the bearer path.
  if (rateKey) {
    const gate = checkRate("upload", rateKey, UPLOAD_LIMIT_PER_HOUR, HOUR_MS);
    if (!gate.allowed) {
      return NextResponse.json(
        {
          error: "rate_limited",
          message: `Upload rate limit exceeded (${UPLOAD_LIMIT_PER_HOUR}/hour per API key). Retry in ${gate.retryAfterSec}s.`,
        },
        { status: 429, headers: { "Retry-After": String(gate.retryAfterSec ?? 60) } },
      );
    }
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "expected multipart form field 'file'" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large: ${file.size} bytes (max ${MAX_BYTES})` },
      { status: 413 },
    );
  }
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return NextResponse.json(
      {
        error: `unsupported mimeType "${mime}". Allowed: pdf, docx, xlsx, pptx, doc, xls, ppt.`,
      },
      { status: 415 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256Hex = createHash("sha256").update(bytes).digest("hex");
  const { doc, isNew } = await createDocumentRow({
    userId,
    filename: file.name,
    mimeType: mime,
    sha256Hex,
    bytes,
  });
  if (isNew) {
    runIngest(doc.id).catch((err) => {
      console.error(`[upload] ingest ${doc.id} threw:`, err);
    });
  }
  return NextResponse.json({
    id: doc.id,
    status: doc.status,
    filename: doc.filename,
    duplicated: !isNew,
  });
}
