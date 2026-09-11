"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import CompanyLinkPicker from "@/components/crm/CompanyLinkPicker";
import { crmFetch } from "@/lib/crm";
import { parsePipelineEntry } from "@/lib/pipeline-entry";

const input = "min-h-11 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-bone outline-none focus:border-amber/60";

export default function NewPipelineOpportunity({ stages, onCreated }: {
  stages: { key: string; label: string }[];
  onCreated: (message: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [stage, setStage] = useState("new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!company || busy) return;
    const entry = parsePipelineEntry({ value: value.trim() === "" ? null : Number(value), pipelineStage: stage });
    if (!entry.ok) { setError(entry.error); return; }
    setBusy(true); setError("");
    try {
      const result = await crmFetch<{ opportunity: { id: string }; created: boolean }>(`/api/crm/companies/${company.id}/pipeline`, {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), value: entry.value, pipelineStage: entry.pipelineStage,
          rationale: "Created by the signed-in user from the Pipeline page" }),
      });
      if (!result.opportunity?.id) throw new Error("The saved opportunity could not be confirmed. Please check your pipeline before trying again.");
      await onCreated(result.created
        ? `${company.name} opportunity created and assigned to you.`
        : `${company.name} already has an open opportunity in your pipeline. Its existing stage and value have been kept; choose Edit opportunity to update it.`);
      setOpen(false); setCompany(null); setTitle(""); setValue(""); setStage("new");
    } catch (err: any) {
      setError(err?.message || "Could not create this opportunity");
    } finally { setBusy(false); }
  }

  return <section className="mb-4 rounded-xl border border-amber/35 bg-panel p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="font-display text-lg text-bone">Create and track opportunities</h2>
        <p className="mt-1 text-sm text-muted">Add a client deal, set its value and move it through your sales stages.</p></div>
      <button type="button" aria-expanded={open} aria-controls="new-pipeline-opportunity" disabled={busy} onClick={() => setOpen(!open)} className="min-h-11 shrink-0 rounded-lg border border-amber/60 bg-amber/15 px-4 py-2 text-sm font-semibold text-amber disabled:opacity-40">{open ? "Close form" : "+ New opportunity"}</button>
    </div>
    {open ? <form id="new-pipeline-opportunity" onSubmit={submit} className="mt-4 border-t border-edge pt-4">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><p className="mb-2 text-sm text-bone">Client</p>
          <CompanyLinkPicker value={company} onChange={setCompany} allowCreate={false} placeholder="Search your clients…" />
          <p className="mt-2 text-xs text-muted">Need a new client? <Link href="/crm/board?tab=clients" className="text-amber underline">Add them in Clients</Link> first.</p>
        </div>
        <label className="sm:col-span-2"><span className="mb-1 block text-sm text-bone">Opportunity name</span><input autoFocus required maxLength={240} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Recruitment support for the autumn intake" className={input} /></label>
        <label><span className="mb-1 block text-sm text-bone">Deal value (£)</span><input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Leave blank if unknown" className={input} /></label>
        <label><span className="mb-1 block text-sm text-bone">Sales stage</span><select value={stage} onChange={(e) => setStage(e.target.value)} className={input}>{stages.filter((s) => !["won", "lost"].includes(s.key)).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
        <p className="text-xs text-muted sm:col-span-2">Assigned to you. If this client already has an open opportunity in your pipeline, we’ll keep that record and its existing details.</p>
        {error ? <p role="alert" className="text-sm text-rust sm:col-span-2">{error}</p> : null}
        <button type="submit" disabled={!company || !title.trim() || busy} className="min-h-11 rounded-lg border border-amber/60 bg-amber/15 px-4 py-2 text-sm font-semibold text-amber disabled:opacity-40 sm:col-span-2">{busy ? "Saving…" : "Create opportunity"}</button>
      </fieldset>
    </form> : null}
  </section>;
}
