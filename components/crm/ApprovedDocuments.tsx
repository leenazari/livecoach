"use client";
import { useEffect, useRef, useState } from "react";
import { crmFetch } from "@/lib/crm";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { APPROVED_DOCUMENTS, MAX_APPROVED_DOCUMENT_BYTES, type ApprovedDocument } from "@/lib/approved-document-policy";

export default function ApprovedDocuments() {
  const [documents, setDocuments] = useState<ApprovedDocument[]>([]);
  const [autoDrafts, setAutoDrafts] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState("adam_brochure");
  async function load() {
    const result = await crmFetch<{ documents: ApprovedDocument[]; autoDrafts: boolean }>("/api/crm/approved-documents");
    setDocuments(result.documents); setAutoDrafts(result.autoDrafts); setLoaded(true);
  }
  useEffect(() => { void load().catch(e => setError(e.message)); }, []);
  async function upload(file: File) {
    setError(""); setMessage("");
    if (!file.name.toLowerCase().endsWith(".pdf") || file.size > MAX_APPROVED_DOCUMENT_BYTES) { setError("Choose a PDF up to 10 MB"); return; }
    setBusy(key);
    try {
      const metadata = { key, name: file.name, size: file.size };
      const prepared = await crmFetch<{ version: string; path: string; token: string; bucket: string }>("/api/crm/approved-documents", { method: "POST", body: JSON.stringify({ ...metadata, action: "prepare" }) });
      const result = await createSupabaseBrowser().storage.from(prepared.bucket).uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: "application/pdf", upsert: false });
      if (result.error) throw new Error("The upload was not confirmed. Refresh Documents before trying again");
      await crmFetch("/api/crm/approved-documents", { method: "POST", body: JSON.stringify({ ...metadata, version: prepared.version, action: "approve" }) });
      await load(); setMessage("Approved PDF saved. New drafts will use this version. Existing mailbox drafts keep their original attachment for review.");
    } catch (e: any) { setError(e.message); }
    finally { setBusy(""); if (input.current) input.current.value = ""; }
  }
  async function toggle() {
    setBusy("settings"); setError("");
    try {
      const result = await crmFetch<{ autoDrafts: boolean }>("/api/crm/approved-documents", { method: "PATCH", body: JSON.stringify({ autoDrafts: !autoDrafts }) });
      setAutoDrafts(result.autoDrafts);
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  }
  return <section className="mb-8 rounded-2xl border border-amber/40 bg-panel p-5">
    <h2 className="text-xl text-bone">Approved brochures and documents</h2>
    <p className="mt-2 text-sm text-muted">Upload the PDFs you approve for client emails. Replacing a document makes the new version available for future drafts. Your files are private to your account.</p>
    <label className="mt-4 flex items-center gap-3 text-sm"><input type="checkbox" checked={autoDrafts} disabled={!!busy || !loaded} onChange={() => void toggle()} /> Automatically prepare Gmail drafts for my new call follow-ups</label>
    <p className="mt-2 text-xs text-muted">Drafts stay unsent. Missing documents, details or unclear recipients are flagged in Tasks. Reminders continue until you finish or defer the work.</p>
    <div className="mt-5 flex flex-wrap gap-3">
      <select aria-label="Document type" value={key} disabled={!!busy} onChange={e => setKey(e.target.value)} className="rounded-lg border border-edge bg-ink p-3 text-sm">{Object.entries(APPROVED_DOCUMENTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <input ref={input} type="file" accept="application/pdf,.pdf" disabled={!!busy} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); }} aria-label="Upload approved PDF" className="max-w-full text-sm" />
    </div>
    {busy && <p role="status" className="mt-3 text-sm text-amber">Saving…</p>}
    {message && <p role="status" className="mt-3 text-sm text-mint">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-rust">{error}</p>}
    <div className="mt-5 grid gap-3 sm:grid-cols-2">{Object.entries(APPROVED_DOCUMENTS).map(([value, label]) => {
      const document = documents.find(d => d.key === value);
      return <div key={value} className="rounded-xl border border-edge p-3 text-sm"><p className="font-medium">{label}</p>{document ? <><a href={`/api/crm/approved-documents/${value}`} className="mt-1 block break-words text-sky underline">{document.name}</a><p className="mt-1 text-xs text-muted">Approved {new Date(document.approvedAt).toLocaleDateString("en-GB")} · {(document.size / 1024 / 1024).toFixed(1)} MB</p></> : <p className="mt-1 text-xs text-muted">No approved PDF uploaded</p>}</div>;
    })}</div>
  </section>;
}
