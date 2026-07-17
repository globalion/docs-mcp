// MCP tools exposed by /api/mcp for docs-mcp.
//
// One skill, six tools:
//   docs_upload   — small (≤10 MB) base64 upload, kicks async ingest
//   docs_list     — list documents owned by the calling key
//   docs_get      — one document's metadata + chunk count
//   docs_search   — semantic search across the user's corpus
//   docs_delete   — permanent delete (also removes chunks + files)
//   docs_balance  — current credit balance + spend recap

import { z } from "zod";

const B64_MAX_CHARS = 14 * 1024 * 1024; // ~10.5 MB raw file

export const TOOL_DEFINITIONS = [
  {
    name: "docs_upload",
    description:
      "Upload a document (PDF / .docx / .xlsx / .pptx / .doc / .xls / .ppt) as base64 bytes. Costs 1 credit per page. Returns the docId immediately; ingest runs async — poll docs_get({id}) until status='ready' (usually 10-60s for a 10-page doc). Max ~10 MB base64 encoded (~7 MB raw). For bigger files, upload via the web dashboard at https://docs.regiq.in/dashboard.",
    inputSchema: z.object({
      filename: z.string().min(1).max(300).describe("Original filename, used as display label."),
      contentBase64: z
        .string()
        .min(10)
        .describe(
          "Base64-encoded file bytes. NO data-URL prefix (no `data:...;base64,`). If you have a data URL, strip everything before the comma.",
        ),
      mimeType: z
        .string()
        .optional()
        .describe(
          "MIME type of the file. If omitted, we infer from the filename extension. Must be one of: application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document (.docx), application/vnd.openxmlformats-officedocument.spreadsheetml.sheet (.xlsx), application/vnd.openxmlformats-officedocument.presentationml.presentation (.pptx), application/msword (.doc), application/vnd.ms-excel (.xls), application/vnd.ms-powerpoint (.ppt).",
        ),
    }),
  },
  {
    name: "docs_list",
    description:
      "List all documents owned by the calling API key. Returns id, filename, mimeType, status, pageCount, creditsSpent, createdAt. Cheap — no chunk content, no vectors.",
    inputSchema: z.object({}),
  },
  {
    name: "docs_get",
    description:
      "Fetch one document's metadata: id, filename, mimeType, status ('pending'|'processing'|'ready'|'failed'), pageCount, chunkCount, creditsSpent, errorMsg (if failed). Poll this after docs_upload until status='ready' before calling docs_search.",
    inputSchema: z.object({
      id: z.string().describe("Document id returned by docs_upload or docs_list."),
    }),
  },
  {
    name: "docs_search",
    description:
      "Semantic search across the caller's documents. Returns the top-k most-relevant chunks with { chunkId, documentId, filename, pageNumber, content, similarity (0..1) }. Free — queries cost no credits. Restrict to specific docs via documentIds. Chain: (1) run docs_search, (2) synthesize an answer from the returned chunks in your own LLM, (3) show the user the answer plus the page-number citations we returned. We deliberately don't synthesize — you bring the model.",
    inputSchema: z.object({
      query: z.string().min(1).max(2000).describe("Natural-language query. Best queries are specific: 'what did we agree the launch date is?', not 'launch info'."),
      k: z
        .number()
        .int()
        .min(1)
        .max(32)
        .optional()
        .describe("Number of chunks to return. Default 8, max 32."),
      documentIds: z
        .array(z.string())
        .optional()
        .describe(
          "Restrict search to specific documents (by id). Omit to search the caller's entire corpus.",
        ),
    }),
  },
  {
    name: "docs_delete",
    description:
      "Permanently delete a document. Removes the DB row, all embedded chunks, and the raw file on disk. Spent credits are NOT refunded — if you want to keep the vectors around, don't delete.",
    inputSchema: z.object({
      id: z.string(),
    }),
  },
  {
    name: "docs_balance",
    description:
      "Return the caller's current credit balance and a summary of the last 10 credit transactions. Use this to check whether the user needs to top up before a large upload.",
    inputSchema: z.object({}),
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export function findTool(name: string) {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}

export function jsonSchemaFor(name: ToolName) {
  const t = findTool(name);
  if (!t) throw new Error(`unknown tool: ${name}`);
  return zodToJsonSchema(t.inputSchema);
}

export function assertBase64Size(b64: string) {
  if (b64.length > B64_MAX_CHARS) {
    throw new Error(
      `file too large: base64 payload is ${b64.length} chars (max ${B64_MAX_CHARS}). Use the web dashboard at https://docs.regiq.in/dashboard for files > ~7 MB.`,
    );
  }
}

// Minimal Zod → JSON Schema. Only handles the shapes used above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zodToJsonSchema(schema: z.ZodTypeAny): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (schema as unknown as { _def: any })._def;
  const description = (schema as unknown as { description?: string }).description;
  const wrap = (v: Record<string, unknown>) => (description ? { ...v, description } : v);
  switch (def.typeName) {
    case "ZodString":
      return wrap({ type: "string" });
    case "ZodNumber":
      return wrap({ type: "number" });
    case "ZodBoolean":
      return wrap({ type: "boolean" });
    case "ZodArray":
      return wrap({ type: "array", items: zodToJsonSchema(def.type) });
    case "ZodOptional":
      return zodToJsonSchema(def.innerType);
    case "ZodDefault": {
      const inner = zodToJsonSchema(def.innerType);
      inner.default = def.defaultValue();
      return inner;
    }
    case "ZodRecord":
      return wrap({ type: "object", additionalProperties: true });
    case "ZodUnknown":
      return wrap({});
    case "ZodObject": {
      const shape = def.shape();
      const props: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape) as [string, z.ZodTypeAny][]) {
        props[k] = zodToJsonSchema(v);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vDef = (v as unknown as { _def: any })._def;
        if (vDef.typeName !== "ZodOptional" && vDef.typeName !== "ZodDefault") {
          required.push(k);
        }
      }
      return wrap({
        type: "object",
        properties: props,
        ...(required.length ? { required } : {}),
      });
    }
    default:
      return wrap({});
  }
}
