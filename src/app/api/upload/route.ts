// POST /api/upload — multipart file upload for the web dashboard AND direct
// programmatic uploads authed by API key.
//
// Auth: session cookie (dashboard drag & drop) OR Bearer API key (curl / MCP
// wrapper). Reads the file, dedupes on sha256, writes to disk, kicks async
// ingest, returns docId.
//
// Size cap: 50 MB per file (dashboard). MCP tool caps smaller (~7 MB raw)
// because base64 inflates JSON payloads.

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";
import { findLiveKey } from "@/lib/keys";
import { createDocumentRow, runIngest } from "@/lib/docs/ingest";
import { ALLOWED_MIME_TYPES } from "@/lib/docs/convert";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request) {
  // Session cookie first (dashboard), then Bearer.
  let userId: string | null = null;
  const session = await auth().catch(() => null);
  if (session?.user?.id) {
    userId = session.user.id;
  } else {
    const authHeader = req.headers.get("authorization") || "";
    const raw = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (raw) {
      const key = await findLiveKey(raw);
      if (key) userId = key.userId;
    }
  }
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
