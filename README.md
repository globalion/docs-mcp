# docs-mcp

Drop any Word, Excel, PDF or PowerPoint into a vector RAG store. Vision-model extraction handles scans, charts, and tables. Every returned chunk carries its page number for precise citations. Priced at exact break-even via Stripe — we make $0 per credit sold.

**Live:** [docs.regiq.in](https://docs.regiq.in)

## What it does

1. **Ingest** — accepts `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.doc`, `.xls`, `.ppt` up to 50 MB.
2. **Extract** — renders every page as an image, runs Google Gemini 2.5 Flash Lite (via OpenRouter) over each page. Text, tables, and figure descriptions come out verbatim.
3. **Store** — chunks (~500 tokens, 50-token overlap), embeds via `openai/text-embedding-3-small` (1536 dims), stored in Postgres + pgvector with page-number metadata.
4. **Retrieve** — cosine-similarity search returns the top-k chunks; your agent synthesizes the answer.

## Tools

| Tool | What it does |
|---|---|
| `docs_upload({filename, contentBase64, mimeType?})` | Small (≤~7 MB) programmatic upload. Ingest runs async. |
| `docs_list()` | All documents owned by the calling key. |
| `docs_get({id})` | One doc's metadata + status + chunk count. |
| `docs_search({query, k?, documentIds?})` | Semantic search. Returns top-k chunks with page numbers. **Free.** |
| `docs_delete({id})` | Permanent delete. |
| `docs_balance()` | Credit balance + last 10 transactions. |

Bigger files: upload via the web dashboard at [docs.regiq.in/dashboard](https://docs.regiq.in/dashboard) (max 50 MB).

## Pricing

**1 credit = 1 page ingested. Queries are free.** New accounts get 100 pages free on sign-up.

| Top-up | Pages you get | ~Docs (10-pg avg) |
|---|---|---|
| $5 | 5,700 | 570 |
| $10 | 11,700 | 1,170 |
| $20 | 23,900 | 2,390 |
| $50 | 60,500 | 6,050 |

Per-page underlying cost is roughly `$0.0005` vision + `$0.00003` embedding via OpenRouter. Prices are set at exact break-even after Stripe's 2.9% + $0.30 fee — that flat fee is why $2 top-ups aren't offered (18% of $2 evaporates to Stripe).

## Setup — any MCP client

1. Sign in at [docs.regiq.in](https://docs.regiq.in) with Google or GitHub.
2. Copy your API key from `/dashboard`.
3. Add to your client config:

```json
{
  "mcpServers": {
    "docs": {
      "url": "https://docs.regiq.in/api/mcp",
      "headers": {
        "Authorization": "Bearer docs_live_..."
      }
    }
  }
}
```

Works in Claude Desktop, Cursor, Zed, and anything else that speaks streamable-http MCP.

## Recommended flow

```
1. docs_upload({filename, contentBase64})   →  { id, status: "processing" }
2. poll docs_get({id}) until status="ready" (~10-60s for 10 pages)
3. docs_search({query: "...", k: 8})        →  chunks with page numbers
4. Your LLM synthesizes an answer and cites the page numbers.
```

## Self-host

```bash
git clone https://github.com/globalion/docs-mcp
cd docs-mcp
cp .env.example .env  # fill in Google OAuth + OpenRouter + (optional) Stripe
docker compose up -d --build
```

Uses `pgvector/pgvector:pg16` image so the vector extension is pre-installed. `docker exec docs-mcp-web npx prisma@6.19.2 db push --accept-data-loss --skip-generate` on first boot to sync the schema (the container CMD does this automatically).

## License

MIT — see [LICENSE](LICENSE). Built by [Shreyas](https://github.com/Shreyas-Profile), shipped by [Globalion](https://github.com/globalion).
