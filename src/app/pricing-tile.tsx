"use client";

// Landing-page pricing tile. Clicking one:
//   - Signed-out → triggers Google sign-in, redirects to /dashboard?buy=<id>
//     after auth so the dashboard auto-fires Stripe Checkout.
//   - Signed-in  → skip straight to /dashboard?buy=<id>.
// Same client component so the JSX on /page.tsx stays declarative.

import { signIn } from "next-auth/react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  id: string;
  priceUsd: number;
  label: string;
  subLabel: string;
  credits: number;
  isSignedIn: boolean;
}

export function PricingTile({ id, priceUsd, label, subLabel, credits, isSignedIn }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function activate() {
    startTransition(() => {
      const dest = `/dashboard?buy=${encodeURIComponent(id)}`;
      if (isSignedIn) {
        router.push(dest);
      } else {
        signIn("google", { callbackUrl: dest });
      }
    });
  }

  return (
    <button
      onClick={activate}
      disabled={pending}
      className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-left transition hover:border-indigo-500 disabled:opacity-60"
    >
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold text-neutral-200">{label}</div>
        <div className="text-2xl font-bold text-indigo-300">${priceUsd}</div>
      </div>
      <div className="mt-2 text-xs text-neutral-500">{credits.toLocaleString()} pages</div>
      <div className="mt-1 text-xs text-neutral-600">{subLabel}</div>
      <div className="mt-3 text-[11px] font-semibold uppercase text-indigo-400">
        {pending ? "Opening…" : isSignedIn ? "Buy →" : "Sign in & buy →"}
      </div>
    </button>
  );
}
