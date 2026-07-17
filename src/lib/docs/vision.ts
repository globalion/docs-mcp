// Vision-model page-to-text extraction. OpenRouter-only per Globalion infra
// rule (never call vendor APIs direct). Default model is the cheapest capable
// one — see .env.example for the override.
//
// The prompt asks for structured extraction: text preserved, tables as
// markdown, figures described briefly. This is what makes docs-mcp work on
// scanned/image-heavy pages that plain PDF text extraction skips.

import { readFile } from "node:fs/promises";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.VISION_MODEL ?? "google/gemini-2.5-flash-lite";

const EXTRACT_PROMPT = `You are a document-extraction assistant. Extract ALL content from this page image.

Return the extraction verbatim in this format:
- Preserve the reading order top-to-bottom, left-to-right (handle multi-column).
- Regular prose: verbatim.
- Headings and sub-headings: prefix with # or ## as appropriate.
- Tables: render as GitHub-flavour markdown tables. Every row on its own line.
- Bullet lists: preserve as - or *.
- Figures/charts/diagrams: describe briefly in [Figure: ...] on their own line, capturing what the reader would learn from it (axis labels, key numbers, trend direction).
- Handwritten annotations: transcribe as best you can, prefix with [handwritten].
- If the page is blank, return exactly: [blank page]

Do NOT summarise. Do NOT add commentary. Do NOT wrap the output in a code block. Output the extracted content ONLY.`;

export interface VisionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Extract text from a single page image (PNG or JPEG).
 * Returns the raw extracted text — chunking happens downstream.
 */
export async function extractPageFromImage(imagePath: string): Promise<VisionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const bytes = await readFile(imagePath);
  const b64 = bytes.toString("base64");
  const mimeType = imagePath.toLowerCase().endsWith(".jpg") || imagePath.toLowerCase().endsWith(".jpeg")
    ? "image/jpeg"
    : "image/png";

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://docs.regiq.in",
      "X-Title": "docs-mcp",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACT_PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${b64}` },
            },
          ],
        },
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`vision extraction failed: HTTP ${res.status} ${errText.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  return {
    text: text.trim(),
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  };
}
