"use client";

import { useState, useTransition } from "react";
import { CREDIT_PACKS } from "@/lib/credits";

export function PricingPanel({ balance }: { balance: number }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function buy(packId: string) {
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? body.error ?? `HTTP ${res.status}`);
        return;
      }
      const { url } = await res.json();
      if (url) window.location.href = url;
    });
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Credit balance
          </div>
          <div className="mt-1 text-3xl font-bold text-indigo-300">
            {balance.toLocaleString()}{" "}
            <span className="text-sm font-normal text-neutral-500">pages</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {CREDIT_PACKS.map((p) => (
          <button
            key={p.id}
            onClick={() => buy(p.id)}
            disabled={pending}
            className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-left transition hover:border-indigo-500 disabled:opacity-60"
          >
            <div className="flex items-baseline justify-between">
              <div className="text-xs font-semibold uppercase text-neutral-400">{p.label}</div>
              <div className="text-lg font-bold text-indigo-300">${p.priceUsd}</div>
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              {p.credits.toLocaleString()} pages
            </div>
            <div className="mt-1 text-[10px] text-neutral-600">{p.subLabel}</div>
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      <p className="mt-3 text-[11px] text-neutral-600">
        Priced at true cost. Free tier: 100 pages on sign-up.
      </p>
    </div>
  );
}
