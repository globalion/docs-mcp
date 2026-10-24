// Health check for future central monitoring across the Globalion MCP fleet.
// Required per shreyas-onboarding.md §7. Also confirms the pgvector
// extension is loaded — a docs-mcp deploy without it would return 200 here
// but fail on every ingest, which is worse than failing loud on boot.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const rows = await prisma.$queryRawUnsafe<Array<{ extname: string }>>(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'",
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "pgvector extension not enabled" },
        { status: 503 },
      );
    }
    return NextResponse.json({
      ok: true,
      service: "docs-mcp",
      version: "0.1.0",
      time: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 503 },
    );
  }
}
