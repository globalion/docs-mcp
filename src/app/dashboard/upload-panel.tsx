"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ACCEPT =
  ".pdf,.docx,.xlsx,.pptx,.doc,.xls,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation";

export function UploadPanel() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <label
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-sm transition ${
          uploading
            ? "border-neutral-700 bg-neutral-950 text-neutral-500"
            : "border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-indigo-500 hover:text-indigo-300"
        }`}
      >
        <input
          type="file"
          multiple
          accept={ACCEPT}
          disabled={uploading}
          onChange={(e) => upload(e.target.files)}
          className="hidden"
        />
        {uploading ? (
          <span>Uploading… ingest continues in the background.</span>
        ) : (
          <>
            <span className="text-neutral-200">Drop files or click to upload</span>
            <span className="mt-1 text-xs text-neutral-500">
              PDF · DOCX · XLSX · PPTX · DOC · XLS · PPT · max 50 MB each
            </span>
          </>
        )}
      </label>
      {error && (
        <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
