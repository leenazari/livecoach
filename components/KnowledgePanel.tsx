"use client";

import { useRef, useState } from "react";

// Compact, single-action uploader: one tap opens the file picker, the file is
// stored against the current session and read for context. Document typing is
// no longer surfaced - everything uploaded here is treated as session context
// (doc_type "cv"), which is what the pre-call flow needs. Kept deliberately
// minimal to match the stepped setup design.
export default function KnowledgePanel({
  sessionId,
  onUploaded,
}: {
  candidate: string;
  sessionId?: string;
  onUploaded?: (detectedName: string | null, docType: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File) {
    setError("");
    setDone(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("doc_type", "cv");
      form.append("sessionId", sessionId || "");

      const res = await fetch(
        `/api/knowledge/upload?sessionId=${encodeURIComponent(sessionId || "")}`,
        { method: "POST", body: form }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      setDone(file.name);
      onUploaded?.(data.candidate || null, data.doc_type || "cv");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.txt,text/plain,application/pdf"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-edge bg-ink/40 px-3.5 py-2.5 text-left font-sans text-sm text-muted transition hover:border-sage/60 hover:text-bone disabled:opacity-50"
      >
        <span className="font-mono text-base leading-none text-sage">+</span>
        {busy
          ? "uploading\u2026"
          : done
          ? `\u2713 ${done} \u00b7 add another`
          : "Add a CV or document (PDF or .txt)"}
      </button>
      {error && (
        <p className="mt-1.5 font-mono text-[0.62rem] text-rust">! {error}</p>
      )}
    </div>
  );
}
