// POST /api/credits/checkout
//   { packId: "pack_micro" }              → fixed pack
//   { customPages: 1234 }                 → dynamically-priced pack
// → { url } for Stripe Checkout redirect.
//
// Returns 503 when STRIPE_SECRET_KEY is unset (dashboard shows the pricing UI
// but the redirect fails cleanly rather than crashing).

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { findPack, computeCustomPack, type Pack } from "@/lib/credits";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  const userEmail = session?.user?.email;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    packId?: string;
    customPages?: number;
  };

  let pack: Pack | null = null;
  if (body.packId) {
    const found = findPack(body.packId);
    if (found) pack = found;
  } else if (body.customPages != null) {
    try {
      pack = computeCustomPack(Number(body.customPages));
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }
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
          unit_amount: pack.unitAmountCents,
          product_data: {
            name: `${pack.credits.toLocaleString()} docs-mcp credits`,
            description: `${pack.label} — ${pack.subLabel}. 1 credit = 1 page ingested.`,
          },
        },
      },
    ],
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
