// Retrieval: query text → embed → cosine search in pgvector.
//
// Prisma doesn't support the `<=>` operator or the `vector` type, so we use
// $queryRawUnsafe. The `documentIds` filter is parameterized as a Postgres
// array literal — safe because we only pass ids returned by our own DB.

import { prisma } from "../db";
import { embedOne } from "./embed";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber: number;
  content: string;
  similarity: number; // 0..1, higher = more similar
}

export interface SearchOptions {
  documentIds?: string[]; // restrict to specific documents; omit = search everything the user owns
  k?: number;             // top-N to return, default 8
}

export async function search(
  userId: string,
  query: string,
  opts: SearchOptions = {},
): Promise<RetrievedChunk[]> {
  const k = Math.min(Math.max(opts.k ?? 8, 1), 32);
  if (!query.trim()) return [];

  const queryVector = await embedOne(query);
  const vecLiteral = `[${queryVector.join(",")}]`;

  // Build the optional document-id filter. When present, must live under
  // this user's ownership — we check that in the SQL WHERE clause.
  const docFilterSql = opts.documentIds && opts.documentIds.length > 0
    ? `AND d.id = ANY($3::text[])`
    : "";

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      chunkId: string;
      documentId: string;
      filename: string;
      pageNumber: number;
      content: string;
      similarity: number;
    }>
  >(
    `SELECT
       c.id           AS "chunkId",
       c."documentId" AS "documentId",
       d.filename     AS filename,
       c."pageNumber" AS "pageNumber",
       c.content      AS content,
       1 - (c.embedding <=> $1::vector) AS similarity
     FROM "DocumentChunk" c
     JOIN "Document" d ON d.id = c."documentId"
     WHERE d."userId" = $2
       AND d.status = 'ready'
       AND c.embedding IS NOT NULL
       ${docFilterSql}
     ORDER BY c.embedding <=> $1::vector
     LIMIT ${k}`,
    vecLiteral,
    userId,
    ...(opts.documentIds && opts.documentIds.length > 0 ? [opts.documentIds] : []),
  );

  return rows;
}
