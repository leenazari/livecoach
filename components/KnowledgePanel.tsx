"use client";

import { useRef, useState } from "react";

type Uploaded = {
  source: string;
  doc_type: string;
  candidate: string | null;
};

const DOC_TYPES = [
  { value: "cv", label: "Candidate CV" },
  { value: "summary", label: "Previous summary" },
  { value: "framework", label: "Question framework" },
];

export default function KnowledgePanel({
  candidate,
  onUploaded,
}: {
  candidate: string;
  onUploaded?: (detectedName: string | null, docType: string) => void;
}) {
  const [docType, setDocType] = useState("cv");
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState<Uploaded[]>([]);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File) {
    setError("");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("doc_type", docType);
      if (docType !== "framework" && candidate) {
        form.append("candidate", candidate);
      }

      const res = await fetch("/api/knowledge/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      setUploaded((prev) => [
        { source: data.source, doc_type: data.doc_type, candidate: data.candidate },
        ...prev,
      ]);

      // Let the console auto-fill the candidate name + know docs are ready.
      onUploaded?.(data.candidate || null, data.doc_type);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-edge bg-panel/50">
      <div className="flex items-center justify-between border-b border-edge px-6 py-3.5">
        <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
          Knowledge base
        </h2>
        <span className="font-mono text-[0.65rem] uppercase tracking-wider text-muted">
          {uploaded.length} doc{uploaded.length === 1 ? "" : "s"} this session
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-4 px-6 py-5">
        <label className="block">
          <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
            Document type
          </span>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 font-sans text-sm text-bone outline-none focus:border-amber/60"
          >
            {DOC_TYPES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
            File (PDF or .txt)
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,text/plain,application/pdf"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="block w-full max-w-xs text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-amber file:px-4 file:py-2 file:font-mono file:text-xs file:uppercase file:tracking-wider file:text-ink hover:file:bg-amberglow"
          />
        </div>

        {docType === "cv" && (
          <p className="font-mono text-[0.7rem] text-muted">
            the candidate name is read from the CV automatically
          </p>
        )}
        {docType === "summary" && !candidate && (
          <p className="font-mono text-[0.7rem] text-muted">
            ⚠︎ upload the CV first so this attaches to the right candidate
          </p>
        )}
        {busy && (
          <span className="thinking font-display text-base">processing…</span>
        )}
      </div>

      {error && (
        <p className="px-6 pb-4 font-mono text-xs text-rust">⚠︎ {error}</p>
      )}

      {uploaded.length > 0 && (
        <div className="flex flex-wrap gap-2 px-6 pb-5">
          {uploaded.map((u, i) => (
            <span
              key={i}
              className="rounded-full border border-sage/40 bg-sage/10 px-3 py-1.5 font-mono text-[0.7rem] text-sage"
            >
              {u.source} · {u.doc_type}
              {u.candidate ? ` · ${u.candidate}` : ""}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
