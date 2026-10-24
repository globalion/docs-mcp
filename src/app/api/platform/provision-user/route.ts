// POST /api/platform/provision-user
//   Headers: X-Platform-Secret: <raw shared secret>
//   Body: { platformRef: string, email?: string }
//   → { userId, apiKey (only on first mint), keyPrefix, isNew }
//
// Called by aggregator platforms (e.g. paperloft) when a user first enables
// this skill in the aggregator's own UI. Idempotent: repeat calls with the
// same platformRef return the same userId, and only mint a new key if the
// user had none active.

import { NextResponse } from "next/server";
import { authPlatform, provisionUser } from "@/lib/platform";

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
    platformRef?: string;
    email?: string;
  };
  if (!body.platformRef || typeof body.platformRef !== "string") {
    return NextResponse.json(
      { error: "platformRef is required" },
      { status: 400 },
    );
  }

  try {
    const result = await provisionUser(platform.id, body.platformRef, body.email);
    return NextResponse.json({
      userId: result.userId,
      apiKey: result.apiKey,
      keyPrefix: result.keyPrefix,
      isNew: result.isNew,
      freeTierCredits: result.isNew ? 100 : 0,
      message: result.isNew
        ? "user provisioned with 100 free pages"
        : result.apiKey
          ? "user existed with no active key; new key minted"
          : "user already provisioned; existing key retained (raw key not re-derivable)",
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "provision failed" },
      { status: 500 },
    );
  }
}
