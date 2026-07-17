"use client";

import { useMemo, useState, useTransition } from "react";
import { CREDIT_PACKS, CUSTOM_MIN_PAGES, CUSTOM_MAX_PAGES } from "@/lib/credits";

// Client mirror of computeCustomPack — same formula, no server round-trip so
// the user sees a live price as they type. The actual charge goes through
// /api/credits/checkout which re-computes server-side (trust nothing from the
// client for the price).
function customPriceCents(pages: number): number {
  if (!Number.isFinite(pages) || pages < CUSTOM_MIN_PAGES) return 100;
  const raw = (pages * 0.0008 + 0.30) / 0.971 * 100;
  return Math.max(100, Math.ceil(raw));
}

export function PricingPanel({ balance }: { balance: number }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [customPages, setCustomPages] = useState<string>("");

  const parsed = customPages ? Number(customPages) : NaN;
  const customValid =
    Number.isFinite(parsed) &&
    Number.isInteger(parsed) &&
    parsed >= CUSTOM_MIN_PAGES &&
    parsed <= CUSTOM_MAX_PAGES;
  const customPrice = useMemo(
    () => (customValid ? customPriceCents(parsed) / 100 : null),
    [parsed, customValid],
  );

  function buyPack(packId: string) {
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

  function buyCustom() {
    if (!customValid) return;
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customPages: parsed }),
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

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {CREDIT_PACKS.map((p) => (
          <button
            key={p.id}
            onClick={() => buyPack(p.id)}
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

      {/* Custom tier — user types page count, price auto-computes */}
      <div className="mt-3 rounded-lg border border-dashed border-neutral-700 bg-neutral-950 p-3">
        <div className="flex items-center gap-3">
          <div className="text-xs font-semibold uppercase text-neutral-400">Custom</div>
          <input
            type="number"
            inputMode="numeric"
            placeholder={`${CUSTOM_MIN_PAGES}–${CUSTOM_MAX_PAGES.toLocaleString()}`}
            value={customPages}
            onChange={(e) => setCustomPages(e.target.value)}
            min={CUSTOM_MIN_PAGES}
            max={CUSTOM_MAX_PAGES}
            step={1}
            className="w-32 rounded border border-neutral-700 bg-black/40 px-2 py-1 text-sm text-neutral-200 focus:border-indigo-500 focus:outline-none"
          />
          <span className="text-xs text-neutral-500">pages</span>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-lg font-bold text-indigo-300">
              {customPrice != null ? `$${customPrice.toFixed(2)}` : "—"}
            </div>
            <button
              onClick={buyCustom}
              disabled={!customValid || pending}
              className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Buy
            </button>
          </div>
        </div>
        {customPages && !customValid && (
          <div className="mt-2 text-[11px] text-amber-400">
            Enter an integer between {CUSTOM_MIN_PAGES.toLocaleString()} and{" "}
            {CUSTOM_MAX_PAGES.toLocaleString()}.
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      <p className="mt-3 text-[11px] text-neutral-600">
        Priced at true cost. Free tier: 100 pages on sign-up. Queries are free.
      </p>
    </div>
  );
}
