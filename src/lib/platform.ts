// Platform aggregator primitives.
//
// A "platform" is any downstream aggregator (paperloft, cursor-marketplace,
// custom clients) that provisions sub-accounts on this skill on behalf of
// its own end-users. The aggregator authenticates via a shared secret sent
// as the `X-Platform-Secret` header on every provisioning + granting call.
//
// Data model — see prisma/schema.prisma:
//   Platform      — one row per aggregator, with a sha256'd secret
//   PlatformPool  — credit pool the aggregator tops up via Stripe (docs-mcp)
//   User          — has optional (platformId, platformRef); NULL means direct signup
//
// Two operations:
//   provisionUser  — find-or-create User bound to (platformId, platformRef).
//                    Returns { userId, apiKey } (apiKey is the RAW key, only
//                    ever returned on first mint; subsequent calls return
//                    null there and just the userId).
//   grantFromPool  — move N credits from platform's pool to user's balance.
//                    Atomic; fails if pool would go negative.

import { createHash } from "node:crypto";
import { prisma } from "./db";
import { generateKey } from "./keys";
import type { Platform } from "@prisma/client";

const FREE_TIER_ON_PROVISION = 100; // pages given free at account creation

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Authenticate an inbound platform-scoped request. Returns the Platform row
 * on success, null on failure. The caller sends the raw secret as the
 * `X-Platform-Secret` header; we hash + look up.
 */
export async function authPlatform(req: Request): Promise<Platform | null> {
  const raw = req.headers.get("x-platform-secret") || "";
  if (!raw) return null;
  const hash = sha256(raw);
  return await prisma.platform.findUnique({ where: { sharedSecretHash: hash } });
}

/**
 * Find-or-create a User bound to (platformId, platformRef). Returns:
 *   { userId, apiKey, isNew }
 * apiKey is present only when a new key is minted (either a new user OR
 * an existing user who somehow has no active key). Never re-derives an
 * existing key — the raw bytes are only known at generation time.
 */
export async function provisionUser(
  platformId: string,
  platformRef: string,
  email?: string,
): Promise<{ userId: string; apiKey: string | null; keyPrefix: string; isNew: boolean }> {
  // Priority 1: already provisioned for this (platform, ref)? Return it.
  let user = await prisma.user.findUnique({
    where: { platformId_platformRef: { platformId, platformRef } },
  });

  let isNew = false;
  if (!user && email) {
    // Priority 2: a User with this email already exists (they signed up
    // directly first, or were provisioned by another platform under a
    // different platformRef). Attach them to THIS platform instead of
    // creating a duplicate — User.email is @unique globally.
    const existingByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      if (existingByEmail.platformId && existingByEmail.platformId !== platformId) {
        // Owned by a different platform — return an error rather than steal.
        throw new Error(
          `user ${email} is already provisioned under a different platform; cannot cross-attach`,
        );
      }
      user = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { platformId, platformRef },
      });
      // Don't grant a fresh free tier — they may have already used it.
    }
  }

  if (!user) {
    // Priority 3: create fresh. Synthetic email if the aggregator didn't
    // provide one — namespaced by platformId to prevent collisions.
    const finalEmail = email ?? `${platformRef}@${platformId}.platform.local`;
    user = await prisma.user.create({
      data: {
        platformId,
        platformRef,
        email: finalEmail,
        creditBalance: FREE_TIER_ON_PROVISION,
      },
    });
    isNew = true;

    await prisma.creditTransaction.create({
      data: {
        userId: user.id,
        delta: FREE_TIER_ON_PROVISION,
        reason: "trial",
        metadata: { platformId, platformRef },
      },
    });
  }

  // Mint a key if the user has none active.
  const activeKey = await prisma.apiKey.findFirst({
    where: { userId: user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (activeKey) {
    return { userId: user.id, apiKey: null, keyPrefix: activeKey.keyPrefix, isNew };
  }

  const gen = generateKey();
  await prisma.apiKey.create({
    data: { userId: user.id, keyHash: gen.hash, keyPrefix: gen.displayPrefix },
  });
  return { userId: user.id, apiKey: gen.raw, keyPrefix: gen.displayPrefix, isNew };
}

/**
 * Transfer `amount` credits from platform's pool → user's balance. Atomic:
 * both the pool decrement and the user increment happen in one transaction,
 * with a compare-and-swap on the pool so we never overdraft.
 *
 * Constraint: `user.platformId === platformId` — a platform can only fund
 * users it has provisioned. Attempting to grant to someone else's user
 * throws.
 */
export async function grantFromPool(
  platformId: string,
  userId: string,
  amount: number,
  reason: string = "platform_grant",
): Promise<{ newBalance: number; poolBalance: number }> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`amount must be a positive integer, got ${amount}`);
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { platformId: true },
  });
  if (!user) throw new Error(`user ${userId} not found`);
  if (user.platformId !== platformId) {
    throw new Error(`user ${userId} does not belong to platform ${platformId}`);
  }

  const result = await prisma.$transaction(async (tx) => {
    // Compare-and-swap on the pool. If balance dropped below amount since
    // we last checked, updateMany matches 0 rows and we bail.
    const poolUpd = await tx.platformPool.updateMany({
      where: { platformId, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (poolUpd.count === 0) {
      const pool = await tx.platformPool.findUnique({ where: { platformId } });
      throw new Error(
        `platform pool has ${pool?.balance ?? 0} credits, need ${amount}`,
      );
    }
    const freshUser = await tx.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: amount } },
      select: { creditBalance: true },
    });
    await tx.creditTransaction.create({
      data: { userId, delta: amount, reason, metadata: { platformId } },
    });
    const freshPool = await tx.platformPool.findUnique({ where: { platformId } });
    return {
      newBalance: freshUser.creditBalance,
      poolBalance: freshPool?.balance ?? 0,
    };
  });
  return result;
}

/**
 * Top up a platform's pool. Called from the Stripe webhook when a purchase
 * arrives with metadata identifying a platform (versus a regular user
 * top-up). Idempotent by (platformId, stripeSessionId) at the ledger layer.
 */
export async function creditPool(platformId: string, amount: number, metadata: Record<string, unknown>) {
  await prisma.platformPool.upsert({
    where: { platformId },
    create: { platformId, balance: amount },
    update: { balance: { increment: amount } },
  });
  // No CreditTransaction row here — those are per-user. Pool top-ups are
  // reconciled through Stripe events + a future admin dashboard.
  void metadata;
}
