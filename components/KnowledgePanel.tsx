"use client";

import { useRef, useState } from "react";
import { extractDocText } from "@/lib/extract-doc";

// Upload a document for the plan. The file's TEXT is extracted IN THE BROWSER
// (pdf.js, with OCR fallback for image PDFs, or mammoth for Word), then only
// that text is sent up - so even a huge or scanned PDF uploads fine. Keeps the
// existing contract: onUploaded(detectedName, docType) and stores into the
// session's context the plan already reads.
export default function KnowledgePanel({
  sessionId,
  onUploaded,
}: {
  candidate?: string;
  sessionId: string;
  onUploaded: (detectedName: string | null, docType: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    setErr("");
    setProgress("reading the file…");
    try {
      const text = await extractDocText(file, setProgress);
      if (!text.trim()) {
        throw new Error(
          "couldn't read any text from that file - if it's a scanned image, try a clearer copy"
        );
      }
      setProgress("saving to this call…");
      const res = await fetch("/api/interview/upload-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, name: file.name, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "could not save the document");
      onUploaded(null, "cv");
      setProgress(
        `added "${file.name}" (${Math.round(text.length / 1000)}k characters of text)`
      );
    } catch (e: any) {
      setErr(e.message || "upload failed");
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  return (
    <div>
      <div
        onClick={() => !busy && inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        className={`cursor-pointer rounded-lg border border-dashed px-4 py-4 text-center transition ${
          drag ? "border-amber/70 bg-amber/[0.06]" : "border-edge bg-ink/40 hover:border-amber/50"
        } ${busy ? "pointer-events-none opacity-70" : ""}`}
      >
        <p className="font-mono text-[0.62rem] uppercase tracking-wider text-bone">
          {busy ? "working…" : "drop a document or click to upload"}
        </p>
        <p className="mt-1 font-mono text-[0.55rem] leading-relaxed text-muted">
          PDF, Word or text. Read in your browser, so big or image-heavy files
          are no problem.
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.csv,application/pdf"
        className="hidden"
        onChange={onPick}
      />
      {progress && (
        <p className="mt-2 font-mono text-[0.58rem] leading-relaxed text-sage">
          {progress}
        </p>
      )}
      {err && (
        <p className="mt-2 font-mono text-[0.58rem] leading-relaxed text-rust">
          {err}
        </p>
      )}
    </div>
  );
}
