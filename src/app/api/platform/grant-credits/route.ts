// POST /api/platform/grant-credits
//   Headers: X-Platform-Secret: <raw shared secret>
//   Body: { userId: string, amount: integer > 0, reason?: string }
//   → { newBalance, poolBalance }
//
// Aggregator moves N credits from its own pool to one of its sub-users.
// Fails if the pool would go negative — aggregator should top up first.

import { NextResponse } from "next/server";
import { authPlatform, grantFromPool } from "@/lib/platform";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const platform = await authPlatform(req);
  if (!platform) {
    return NextResponse.json(
      { error: "unauthorized — set X-Platform-Secret header" },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    userId?: string;
    amount?: number;
    reason?: string;
  };
  if (!body.userId || typeof body.userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive integer" },
      { status: 400 },
    );
  }

  try {
    const result = await grantFromPool(
      platform.id,
      body.userId,
      amount,
      body.reason ?? "platform_grant",
    );
    return NextResponse.json(result);
  } catch (err) {
    // 409 for insufficient pool (recoverable) vs 400/500 for others
    const msg = (err as Error).message ?? "grant failed";
    const status = /insufficient|does not belong/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
