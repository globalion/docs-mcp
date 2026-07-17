// DELETE /api/docs/:id — remove a document (owner-only). Auth via session
// cookie (dashboard) or Bearer key (MCP / curl). Cascades chunks + wipes
// the raw file dir.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { findLiveKey } from "@/lib/keys";
import { prisma } from "@/lib/db";
import { purgeDocumentFiles } from "@/lib/docs/ingest";

export const runtime = "nodejs";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

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

  const doc = await prisma.document.findFirst({ where: { id, userId } });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.document.delete({ where: { id: doc.id } });
  await purgeDocumentFiles(userId, doc.id);

  return NextResponse.json({ id: doc.id, deleted: true });
}
