// POST /api/credits/checkout { packId } → { url } for Stripe Checkout redirect.
//
// Returns 503 with a friendly hint when STRIPE_SECRET_KEY isn't set yet —
// the dashboard shows "billing coming soon" instead of crashing.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { findPack } from "@/lib/credits";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  const userEmail = session?.user?.email;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { packId?: string };
  const pack = body.packId ? findPack(body.packId) : null;
  if (!pack) return NextResponse.json({ error: "unknown pack" }, { status: 400 });

  if (!isStripeConfigured()) {
    return NextResponse.json(
      {
        error: "billing_disabled",
        message:
          "Billing isn't turned on yet. STRIPE_SECRET_KEY is unset on this deploy.",
      },
      { status: 503 },
    );
  }

  const stripe = getStripe()!;
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || new URL(req.url).origin;

  const cs = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: userEmail ?? undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: pack.priceUsd * 100,
          product_data: {
            name: `${pack.credits.toLocaleString()} docs-mcp credits`,
            description: `${pack.label} pack — ${pack.subLabel}. 1 credit = 1 page ingested.`,
          },
        },
      },
    ],
    // Stashed on the session so the webhook doesn't need a DB lookup.
    metadata: {
      userId,
      packId: pack.id,
      credits: String(pack.credits),
    },
    success_url: `${base}/dashboard?purchase=success`,
    cancel_url: `${base}/dashboard?purchase=cancelled`,
  });

  return NextResponse.json({ url: cs.url });
}
