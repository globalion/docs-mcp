// POST /api/docs/:id/retry
//
// After a user tops up credits, they hit this to resume an ingest that got
// stuck in status="needs_credits". runIngest is idempotent: it re-reads the
// cached page-*.png files (no re-conversion), does the balance check again,
// deducts, then vision + embed.
//
// Also works to retry a "failed" doc — safe because Phase 2 clears prior
// chunks before inserting fresh ones.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { findLiveKey } from "@/lib/keys";
import { prisma } from "@/lib/db";
import { runIngest } from "@/lib/docs/ingest";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // Session cookie first (dashboard), Bearer fallback (MCP / curl).
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

  if (doc.status !== "needs_credits" && doc.status !== "failed") {
    return NextResponse.json(
      { error: `cannot retry a doc in status "${doc.status}"` },
      { status: 409 },
    );
  }

  // Reset to pending so runIngest will pick it up.
  await prisma.document.update({
    where: { id: doc.id },
    data: { status: "pending", errorMsg: null },
  });

  // Fire-and-forget so we don't block the response.
  runIngest(doc.id).catch((err) => {
    console.error(`[retry] runIngest ${doc.id} threw:`, err);
  });

  return NextResponse.json({ id: doc.id, status: "processing" });
}
