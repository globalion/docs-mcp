// OpenRouter embeddings client. text-embedding-3-small (1536 dims) matches
// the vector column width declared in prisma/schema.prisma. If you change
// the model, you MUST also change the column width AND reindex.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/embeddings";
const MODEL = process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small";

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

/**
 * Embed a batch of strings. OpenRouter's embeddings endpoint is
 * OpenAI-compatible; a single call accepts an array of up to ~2K inputs.
 * We batch by ~64 to keep individual requests small and stay well under
 * timeouts on large uploads.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  if (texts.length === 0) return [];

  const BATCH = 64;
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://docs.regiq.in",
        "X-Title": "docs-mcp",
      },
      body: JSON.stringify({ model: MODEL, input: slice }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`embedding failed: HTTP ${res.status} ${err.slice(0, 300)}`);
    }
    const json = (await res.json()) as EmbeddingResponse;
    // Response order matches input order by index.
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    for (const row of sorted) all.push(row.embedding);
  }
  return all;
}

export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embedBatch([text]);
  return v;
}
