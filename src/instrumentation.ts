// Next.js server-boot hook. Runs once per server start (Node runtime only,
// not Edge). We use it to guarantee the pgvector extension is enabled in
// the database before any query hits a vector column.
//
// pgvector/pgvector:pg16 ships the extension pre-installed but not always
// pre-enabled on a fresh DB. `CREATE EXTENSION IF NOT EXISTS vector` is
// idempotent and cheap.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Dynamic import so the Prisma client isn't loaded in Edge builds.
  const { prisma } = await import("./lib/db");
  try {
    await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector");
    console.log("[docs-mcp] pgvector extension ready");
  } catch (err) {
    console.error("[docs-mcp] failed to enable pgvector extension:", err);
  }
}
