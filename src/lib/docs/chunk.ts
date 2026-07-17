// Simple character-based chunker with token approximation. Deliberately
// dumb — we don't need a tokenizer dep, and page-boundary splits already
// give us good semantic boundaries for RAG.
//
// One chunk ≈ 500 tokens ≈ 2000 chars (4:1 rule of thumb for English +
// code-ish content). 50-token overlap = 200 chars.

const TARGET_CHARS = 2000;
const OVERLAP_CHARS = 200;
const CHARS_PER_TOKEN = 4;

export interface Chunk {
  content: string;
  tokenCount: number;
}

export function chunkPageText(text: string): Chunk[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  if (cleaned.length <= TARGET_CHARS) {
    return [
      {
        content: cleaned,
        tokenCount: Math.ceil(cleaned.length / CHARS_PER_TOKEN),
      },
    ];
  }
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(start + TARGET_CHARS, cleaned.length);
    // Prefer to split on paragraph or sentence boundary near `end`.
    let cut = end;
    if (end < cleaned.length) {
      const window = cleaned.slice(start, end);
      const lastPara = window.lastIndexOf("\n\n");
      const lastSentence = window.lastIndexOf(". ");
      const boundary = Math.max(lastPara, lastSentence);
      if (boundary > TARGET_CHARS * 0.6) {
        cut = start + boundary + (lastPara === boundary ? 2 : 2);
      }
    }
    const content = cleaned.slice(start, cut).trim();
    chunks.push({
      content,
      tokenCount: Math.ceil(content.length / CHARS_PER_TOKEN),
    });
    if (cut >= cleaned.length) break;
    start = Math.max(cut - OVERLAP_CHARS, start + 1);
  }
  return chunks;
}
