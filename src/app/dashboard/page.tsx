import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCurrentKeyPrefix } from "@/lib/keys";
import { readBalance } from "@/lib/credits";
import { KeyPanel } from "./key-panel";
import { UploadPanel } from "./upload-panel";
import { PricingPanel } from "./pricing-panel";
import { DocActions } from "./doc-actions";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const sp = await searchParams;
  const rawKey = typeof sp.freshKey === "string" ? sp.freshKey : null;
  const purchase = typeof sp.purchase === "string" ? sp.purchase : null;
  const autoBuyPackId = typeof sp.buy === "string" ? sp.buy : undefined;

  const [prefix, balance, docs] = await Promise.all([
    getCurrentKeyPrefix(session.user.id),
    readBalance(session.user.id),
    prisma.document.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { chunks: true } } },
      take: 50,
    }),
  ]);

  // Gate: hide the upload zone if the user has zero balance AND zero docs.
  // If they've uploaded before we let them stay in the flow (they can still
  // delete/retry existing docs). If they've never uploaded we push them at
  // the pricing panel first so they don't get a confusing "insufficient
  // credits" error on their very first drag-and-drop.
  const showUpload = balance > 0 || docs.length > 0;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">docs-mcp dashboard</h1>
          <p className="mt-1 text-sm text-neutral-400">Signed in as {session.user.email}</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Sign out
          </button>
        </form>
      </header>

      {purchase === "success" && (
        <div className="mb-6 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          Payment received — credits added to your balance. If a document was
          waiting on credits, hit <strong>Retry</strong> next to it below.
        </div>
      )}
      {purchase === "cancelled" && (
        <div className="mb-6 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
          Checkout cancelled. No charge.
        </div>
      )}

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          1. Credits
        </h2>
        <PricingPanel balance={balance} autoBuyPackId={autoBuyPackId} />
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          2. Upload documents
        </h2>
        {showUpload ? (
          <UploadPanel />
        ) : (
          <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-5 text-center">
            <div className="text-sm font-semibold text-amber-200">
              Top up credits above to unlock uploads.
            </div>
            <div className="mt-1 text-xs text-amber-200/70">
              1 credit = 1 page. Try the $1 Micro pack to test with ~80 documents.
              Queries are free once your docs are ingested.
            </div>
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          3. Your documents{" "}
          <span className="text-neutral-600 normal-case">
            — {docs.length === 0 ? "none yet" : `${docs.length} total`}
          </span>
        </h2>
        {docs.length === 0 ? (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 text-sm text-neutral-400">
            Nothing yet. Once you have credits and upload a file, it appears here.
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map((d) => {
              const statusColor =
                d.status === "ready"
                  ? "text-emerald-400"
                  : d.status === "failed"
                    ? "text-red-400"
                    : d.status === "needs_credits"
                      ? "text-amber-300"
                      : "text-amber-400";
              return (
                <div
                  key={d.id}
                  className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-neutral-100">{d.filename}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                        <span className={statusColor}>{d.status}</span>
                        {d.pageCount > 0 && <span>{d.pageCount} pages</span>}
                        {d._count.chunks > 0 && <span>{d._count.chunks} chunks</span>}
                        {d.creditsSpent > 0 && <span>{d.creditsSpent} credits</span>}
                        <span>{new Date(d.createdAt).toISOString().slice(0, 16).replace("T", " ")}</span>
                      </div>
                      {d.errorMsg && (
                        <div
                          className={`mt-2 text-xs ${
                            d.status === "needs_credits" ? "text-amber-300" : "text-red-400"
                          }`}
                        >
                          {d.errorMsg}
                        </div>
                      )}
                    </div>
                    <DocActions docId={d.id} status={d.status} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section id="api-key" className="mb-6 scroll-mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          4. MCP API key
        </h2>
        <KeyPanel initialPrefix={prefix} freshKey={rawKey} />
      </section>

      <section className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Claude Desktop / Cursor config
        </div>
        <pre className="overflow-x-auto rounded bg-black/40 p-3 text-xs text-neutral-200">
{`{
  "mcpServers": {
    "docs": {
      "url": "https://docs.regiq.in/api/mcp",
      "headers": {
        "Authorization": "Bearer <PASTE_YOUR_KEY>"
      }
    }
  }
}`}
        </pre>
        <p className="mt-3 text-xs text-neutral-500">
          <Link href="/" className="underline">← Back to overview</Link>
        </p>
      </section>
    </main>
  );
}
