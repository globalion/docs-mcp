"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Row-level actions on a Document card. Retry re-queues an ingest that
 * stopped at needs_credits (or failed); Delete removes the row + files.
 */
export function DocActions({
  docId,
  status,
}: {
  docId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const canRetry = status === "needs_credits" || status === "failed";
  const canDelete = true;

  function retry() {
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/docs/${docId}/retry`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    });
  }

  function del() {
    if (!confirm("Delete this document? Chunks + raw file will be gone forever.")) return;
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/docs/${docId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {canRetry && (
          <button
            onClick={retry}
            disabled={pending}
            className="rounded border border-indigo-500/60 bg-indigo-500/10 px-2 py-1 text-xs text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-60"
          >
            {pending ? "…" : "Retry"}
          </button>
        )}
        {canDelete && (
          <button
            onClick={del}
            disabled={pending}
            className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-60"
          >
            Delete
          </button>
        )}
      </div>
      {error && <div className="text-[10px] text-red-400">{error}</div>}
    </div>
  );
}
