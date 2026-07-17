// Credit economics for docs-mcp.
//
// Unit: 1 credit = 1 page ingested (vision extract + embed). Queries are
// free (no LLM synthesis on our side — the calling agent brings the model).
//
// Prices are set to true break-even AFTER Stripe fees (2.9% + $0.30). The
// smallest pack is $5 because $2 loses ~18% to the flat fee.
//
// Underlying cost per page (Gemini 2.5 Flash Lite via OpenRouter + embedding):
//   input:  ~2200 tokens × $0.075/M ≈ $0.000165
//   output: ~1200 tokens × $0.30/M  ≈ $0.000360
//   embed:  ~1500 tokens × $0.02/M  ≈ $0.000030
//   ------------------------------------------
//   total:  ≈ $0.00056/page → priced at $0.0008/page for headroom.
//
// Verify: 5700 credits × $0.0008 = $4.56. Stripe takes 2.9%+$0.30 on $5 =
// $0.445; net $4.555. Sits right at break-even.

import { prisma } from "./db";

export const CREDITS_PER_PAGE = 1;

export interface QuoteBreakdown {
  totalCredits: number;
  pages: number;
}

export function quoteCredits(pageCount: number): QuoteBreakdown {
  return { totalCredits: pageCount * CREDITS_PER_PAGE, pages: pageCount };
}

/**
 * Atomically check + deduct. Returns the new balance on success, or null if
 * the user doesn't have enough credits. Race-safe: the where-clause on
 * `creditBalance >= cost` makes the UPDATE a compare-and-swap.
 */
export async function tryDeduct(
  userId: string,
  cost: number,
  reason: string,
  docId?: string,
): Promise<number | null> {
  if (cost <= 0) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    });
    return u?.creditBalance ?? 0;
  }
  const result = await prisma.$transaction(async (tx) => {
    const upd = await tx.user.updateMany({
      where: { id: userId, creditBalance: { gte: cost } },
      data: { creditBalance: { decrement: cost } },
    });
    if (upd.count === 0) return null;
    await tx.creditTransaction.create({
      data: { userId, delta: -cost, reason, docId },
    });
    const fresh = await tx.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    });
    return fresh?.creditBalance ?? 0;
  });
  return result;
}

/**
 * Refund credits when an ingest fails after we've already deducted. Never
 * throws — logs on failure so the caller doesn't leak the error to the user.
 */
export async function refund(userId: string, amount: number, docId?: string): Promise<void> {
  if (amount <= 0) return;
  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { creditBalance: { increment: amount } },
      }),
      prisma.creditTransaction.create({
        data: { userId, delta: amount, reason: "refund", docId },
      }),
    ]);
  } catch (err) {
    console.error("[credits] refund failed for user", userId, err);
  }
}

export async function readBalance(userId: string): Promise<number> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { creditBalance: true },
  });
  return u?.creditBalance ?? 0;
}

export async function grant(
  userId: string,
  amount: number,
  reason: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (amount <= 0) return;
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: amount } },
    }),
    prisma.creditTransaction.create({
      data: {
        userId,
        delta: amount,
        reason,
        metadata: metadata
          ? (JSON.parse(JSON.stringify(metadata)) as object)
          : undefined,
      },
    }),
  ]);
}

/**
 * Credit packs — priced at exact break-even after Stripe fees.
 * The starter pack advertises "570 documents" assuming ~10 pages/doc.
 */
export const CREDIT_PACKS = [
  {
    id: "pack_starter",
    priceUsd: 5,
    credits: 5700,
    label: "Starter",
    subLabel: "~570 docs @ 10 pg avg",
  },
  {
    id: "pack_regular",
    priceUsd: 10,
    credits: 11700,
    label: "Regular",
    subLabel: "~1,170 docs @ 10 pg avg",
  },
  {
    id: "pack_bulk",
    priceUsd: 20,
    credits: 23900,
    label: "Bulk",
    subLabel: "~2,390 docs @ 10 pg avg",
  },
  {
    id: "pack_pro",
    priceUsd: 50,
    credits: 60500,
    label: "Pro",
    subLabel: "~6,050 docs @ 10 pg avg",
  },
] as const;

export type CreditPackId = (typeof CREDIT_PACKS)[number]["id"];

export function findPack(id: string) {
  return CREDIT_PACKS.find((p) => p.id === id);
}
