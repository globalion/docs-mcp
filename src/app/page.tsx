import Link from "next/link";
import { auth, enabledProviders } from "@/lib/auth";
import { SignInButtons } from "./signin-button";
import { CREDIT_PACKS } from "@/lib/credits";

const CONFIG_SNIPPET = `{
  "mcpServers": {
    "docs": {
      "url": "https://docs.regiq.in/api/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_KEY>"
      }
    }
  }
}`;

export default async function LandingPage() {
  const session = await auth().catch(() => null);
  const signedIn = !!session?.user;

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <div className="mb-14">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
          Docs → vector RAG · MCP · streamable-http
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">docs-mcp</h1>
        <p className="mt-4 max-w-2xl text-lg text-neutral-400">
          Drop any Word, Excel, PDF or PowerPoint and query it back with citations.
          Vision-model extraction handles scans, charts and tables — nothing gets
          lost in plain-text stripping. Every returned chunk carries its page
          number, so answers link straight to the source.
        </p>
        <div className="mt-8">
          {signedIn ? (
            <div className="flex gap-3">
              <Link
                href="/dashboard"
                className="rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400"
              >
                Open dashboard →
              </Link>
              <Link
                href="https://github.com/globalion/docs-mcp"
                target="_blank"
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-5 py-2.5 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                GitHub ↗
              </Link>
            </div>
          ) : (
            <div className="max-w-sm">
              <SignInButtons providers={enabledProviders} />
              <Link
                href="https://github.com/globalion/docs-mcp"
                target="_blank"
                className="mt-2 block text-center text-xs text-neutral-500 underline hover:text-neutral-300"
              >
                View on GitHub ↗
              </Link>
            </div>
          )}
        </div>
      </div>

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Pricing — priced at true cost, we make $0
        </h2>
        <p className="mb-4 text-sm text-neutral-400">
          1 credit = 1 page ingested (vision extract + embed). <strong className="text-neutral-200">Queries are free.</strong>{" "}
          New accounts get <strong className="text-indigo-300">100 pages free</strong> to try it out.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {CREDIT_PACKS.map((p) => (
            <div key={p.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold text-neutral-200">{p.label}</div>
                <div className="text-2xl font-bold text-indigo-300">${p.priceUsd}</div>
              </div>
              <div className="mt-2 text-xs text-neutral-500">
                {p.credits.toLocaleString()} pages
              </div>
              <div className="mt-1 text-xs text-neutral-600">{p.subLabel}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-neutral-500">
          Or pick any page count on the dashboard — Custom pricing scales linearly.
          Per-page cost: ~$0.0005 vision + ~$0.00003 embedding via OpenRouter
          (Gemini 2.5 Flash Lite + text-embedding-3-small). Priced at zero margin;
          $1 is the smallest pack because Stripe&apos;s flat $0.30 fee makes anything
          less absurd (a $0.50 charge would lose 60% to Stripe).
        </p>
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          How it works
        </h2>
        <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-xs leading-relaxed text-neutral-300">
{`Upload doc  →  render each page as image
                       │
                       ▼
       Gemini 2.5 Flash Lite reads the page
       (text · tables · figures · handwriting)
                       │
                       ▼
       Chunk (500 tokens, 50 overlap) + embed
       (text-embedding-3-small, 1536 dims)
                       │
                       ▼
       Store in pgvector · metadata:
       docId · filename · pageNumber · sha256
                       │
                       ▼
     docs_search(query, k=8)  →  top chunks
     with { page, similarity, deep link }
                       │
                       ▼
       Your agent synthesizes the answer.
       (We don't — you bring the LLM.)`}
        </pre>
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Setup for any MCP client
        </h2>
        <ol className="space-y-2 text-neutral-300">
          <li>1. Sign in above.</li>
          <li>2. Copy your MCP API key from /dashboard.</li>
          <li>3. Paste this into your agent&apos;s config:</li>
        </ol>
        <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-xs leading-relaxed text-neutral-200">
          {CONFIG_SNIPPET}
        </pre>
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Limits (per API key)
        </h2>
        <div className="grid grid-cols-1 gap-2 text-sm text-neutral-400 sm:grid-cols-2">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
            <div className="text-xs uppercase text-neutral-500">Free tier</div>
            <div className="mt-1 text-neutral-200">100 pages on sign-up</div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
            <div className="text-xs uppercase text-neutral-500">Upload rate</div>
            <div className="mt-1 text-neutral-200">60 uploads / hour</div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
            <div className="text-xs uppercase text-neutral-500">Max file size</div>
            <div className="mt-1 text-neutral-200">50 MB via dashboard · ~7 MB via <code className="rounded bg-black/40 px-1 text-indigo-300">docs_upload</code></div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
            <div className="text-xs uppercase text-neutral-500">Search</div>
            <div className="mt-1 text-neutral-200">Unlimited · queries are free</div>
          </div>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          For aggregator platforms
        </h2>
        <p className="text-sm text-neutral-400">
          Building an AI-agent platform? You can offer docs-mcp to your users
          without each of them signing up here. Register as a Platform, top
          up a shared credit pool via Stripe, and provision sub-accounts on
          behalf of your users — each with their own isolated tenant (docs
          stay private per user) but funded from your pool.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-xs leading-relaxed text-neutral-200">
{`# Provision a sub-account for one of your users
curl -X POST https://docs.regiq.in/api/platform/provision-user \\
  -H "X-Platform-Secret: <your platform secret>" \\
  -H "Content-Type: application/json" \\
  -d '{"platformRef":"user@example.com"}'
# → { userId, apiKey, freeTierCredits: 100, isNew: true }

# Grant more credits from your pool
curl -X POST https://docs.regiq.in/api/platform/grant-credits \\
  -H "X-Platform-Secret: <your platform secret>" \\
  -H "Content-Type: application/json" \\
  -d '{"userId":"<from provision>","amount":500}'`}
        </pre>
        <p className="mt-3 text-xs text-neutral-500">
          Get your platform secret by emailing shreyas.pavuluri@gmail.com.
          Paperloft (paperloft.uk) is already wired this way — enable the docs
          skill inside paperloft and everything just works.
        </p>
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          MCP tools
        </h2>
        <ul className="space-y-1 text-sm text-neutral-400">
          <li>• <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-indigo-300">docs_upload({`{filename, contentBase64}`})</code> — small (≤~7 MB) programmatic upload.</li>
          <li>• <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-indigo-300">docs_list()</code> — return everything you own.</li>
          <li>• <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-indigo-300">docs_get({`{id}`})</code> — one doc&apos;s metadata + status.</li>
          <li>• <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-indigo-300">docs_search({`{query, k?, documentIds?}`})</code> — semantic search, top-k chunks with page numbers.</li>
          <li>• <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-indigo-300">docs_delete({`{id}`})</code> — permanent.</li>
          <li>• <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-indigo-300">docs_balance()</code> — credit balance + last 10 transactions.</li>
        </ul>
      </section>

      <footer className="mt-16 border-t border-neutral-800 pt-6 text-xs text-neutral-500">
        Built by{" "}
        <Link href="https://github.com/Shreyas-Profile" target="_blank" className="underline">
          Shreyas
        </Link>{" "}
        · Shipped by{" "}
        <Link href="https://github.com/globalion" target="_blank" className="underline">
          Globalion
        </Link>{" "}
        · MIT
      </footer>
    </main>
  );
}
