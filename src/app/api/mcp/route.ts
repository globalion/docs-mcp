// MCP-over-HTTP endpoint for docs-mcp. JSON-RPC 2.0. Auth: Bearer <apiKey>.
//
// Tools defined in src/lib/mcp/tools.ts. Upload work is dispatched to the
// ingest pipeline as a fire-and-forget so tools/call returns promptly.

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { findLiveKey } from "@/lib/keys";
import { prisma } from "@/lib/db";
import { readBalance } from "@/lib/credits";
import {
  TOOL_DEFINITIONS,
  findTool,
  jsonSchemaFor,
  assertBase64Size,
  type ToolName,
} from "@/lib/mcp/tools";
import { createDocumentRow, runIngest } from "@/lib/docs/ingest";
import { search } from "@/lib/docs/retrieve";
import { ALLOWED_MIME_TYPES, extForMime } from "@/lib/docs/convert";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "docs-mcp", version: "0.1.0" };

export async function POST(req: Request) {
  const rpc = await req.json().catch(() => null);
  if (!isValidRpc(rpc)) return jsonRpcError(null, -32700, "Parse error");

  if (rpc.method === "initialize") {
    return jsonRpcOk(rpc.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  const auth = req.headers.get("authorization") || "";
  const raw = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const key = raw ? await findLiveKey(raw) : null;
  if (!key) {
    return jsonRpcError(rpc.id, -32001, "Unauthorized — set Authorization: Bearer <key>");
  }
  const userId = key.userId;

  switch (rpc.method) {
    case "tools/list":
      return jsonRpcOk(rpc.id, {
        tools: TOOL_DEFINITIONS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: jsonSchemaFor(t.name),
        })),
      });

    case "tools/call": {
      const { name, arguments: args } = (rpc.params ?? {}) as {
        name?: string;
        arguments?: unknown;
      };
      if (!name) return jsonRpcError(rpc.id, -32602, "Missing tool name");
      const tool = findTool(name);
      if (!tool) return jsonRpcError(rpc.id, -32601, `Unknown tool: ${name}`);

      const parsed = tool.inputSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return jsonRpcError(
          rpc.id,
          -32602,
          "Invalid arguments: " + JSON.stringify(parsed.error.flatten()),
        );
      }

      try {
        const result = await runTool(name as ToolName, parsed.data, userId);
        return jsonRpcOk(rpc.id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        });
      } catch (err) {
        return jsonRpcOk(rpc.id, {
          isError: true,
          content: [{ type: "text", text: (err as Error).message || String(err) }],
        });
      }
    }

    case "ping":
      return jsonRpcOk(rpc.id, {});

    default:
      return jsonRpcError(rpc.id, -32601, `Method not found: ${rpc.method}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runTool(name: ToolName, args: any, userId: string) {
  switch (name) {
    case "docs_upload":
      return await handleUpload(userId, args);
    case "docs_list":
      return await handleList(userId);
    case "docs_get":
      return await handleGet(userId, args.id);
    case "docs_search":
      return await handleSearch(userId, args);
    case "docs_delete":
      return await handleDelete(userId, args.id);
    case "docs_balance":
      return await handleBalance(userId);
  }
}

async function handleUpload(
  userId: string,
  args: { filename: string; contentBase64: string; mimeType?: string },
) {
  assertBase64Size(args.contentBase64);
  const bytes = Buffer.from(args.contentBase64, "base64");
  const mime = args.mimeType ?? inferMimeFromFilename(args.filename);
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    throw new Error(
      `unsupported mimeType "${mime}". Allowed: pdf, docx, xlsx, pptx, doc, xls, ppt.`,
    );
  }
  const sha256Hex = createHash("sha256").update(bytes).digest("hex");
  const { doc, isNew } = await createDocumentRow({
    userId,
    filename: args.filename,
    mimeType: mime,
    sha256Hex,
    bytes,
  });
  if (isNew) {
    // Fire-and-forget — MCP client polls docs_get for status.
    runIngest(doc.id).catch((err) => {
      console.error(`[mcp] ingest ${doc.id} threw:`, err);
    });
  }
  return {
    id: doc.id,
    status: doc.status,
    filename: doc.filename,
    duplicated: !isNew,
    message: isNew
      ? "Upload accepted. Poll docs_get({id}) until status='ready' (~10-60s for a 10-page doc)."
      : "Duplicate — already have this file. Existing doc returned.",
  };
}

async function handleList(userId: string) {
  const docs = await prisma.document.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      status: true,
      pageCount: true,
      bytes: true,
      creditsSpent: true,
      createdAt: true,
    },
    take: 200,
  });
  return { count: docs.length, documents: docs };
}

async function handleGet(userId: string, id: string) {
  const doc = await prisma.document.findFirst({
    where: { id, userId },
    include: { _count: { select: { chunks: true } } },
  });
  if (!doc) throw new Error(`document ${id} not found`);
  return {
    id: doc.id,
    filename: doc.filename,
    mimeType: doc.mimeType,
    status: doc.status,
    pageCount: doc.pageCount,
    chunkCount: doc._count.chunks,
    bytes: doc.bytes,
    creditsSpent: doc.creditsSpent,
    errorMsg: doc.errorMsg,
    createdAt: doc.createdAt,
  };
}

async function handleSearch(
  userId: string,
  args: { query: string; k?: number; documentIds?: string[] },
) {
  const chunks = await search(userId, args.query, {
    k: args.k,
    documentIds: args.documentIds,
  });
  return { count: chunks.length, chunks };
}

async function handleDelete(userId: string, id: string) {
  const doc = await prisma.document.findFirst({ where: { id, userId } });
  if (!doc) throw new Error(`document ${id} not found`);
  // Cascade deletes chunks (schema onDelete: Cascade). Raw file on /data/docs
  // gets orphaned — a periodic sweeper could reap those, but for now it's
  // a small cost tradeoff vs. the risk of accidental unlink.
  await prisma.document.delete({ where: { id: doc.id } });
  return { id: doc.id, deleted: true };
}

async function handleBalance(userId: string) {
  const [balance, txs] = await Promise.all([
    readBalance(userId),
    prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, delta: true, reason: true, docId: true, createdAt: true },
    }),
  ]);
  return {
    balance,
    unit: "1 credit = 1 page ingested",
    topUp: "Buy more at https://docs.regiq.in/dashboard",
    recentTransactions: txs,
  };
}

function inferMimeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".pptx"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  return "application/octet-stream";
}

// silence unused warning for a helper we may reactivate later
void extForMime;

interface RpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

function isValidRpc(x: unknown): x is RpcRequest {
  if (!x || typeof x !== "object") return false;
  const r = x as RpcRequest;
  return r.jsonrpc === "2.0" && typeof r.method === "string";
}

function jsonRpcOk(id: RpcRequest["id"] | undefined, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function jsonRpcError(
  id: RpcRequest["id"] | undefined | null,
  code: number,
  message: string,
) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status: code === -32001 ? 401 : 200 },
  );
}
