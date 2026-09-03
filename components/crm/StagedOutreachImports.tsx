"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { crmFetch } from "@/lib/crm";
import { parseCsvRows, type StagedOutreachImportRow } from "@/lib/outreach-import";

type TeamMember = { userId: string; name: string };
type ImportBatch = {
  id: string;
  source_name: string;
  status: "staged" | "applied" | "undone" | "cancelled" | "failed";
  row_count: number;
  ready_count: number;
  duplicate_count: number;
  review_count: number;
  invalid_count: number;
  rows: StagedOutreachImportRow[];
  applied_result: Record<string, any>;
  assigned_to_user_id: string | null;
  applied_at?: string | null;
  created_at: string;
};

const input =
  "w-full rounded-lg border border-edge bg-ink/50 px-3 py-2.5 text-sm text-bone placeholder:text-muted focus:border-amber/60 focus:outline-none";
const button =
  "min-h-11 rounded-lg border border-edge px-3 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-bone transition hover:border-amber/60 hover:text-amber disabled:cursor-not-allowed disabled:opacity-40";
const primary =
  "min-h-11 rounded-lg border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-40";

export default function StagedOutreachImports({
  team,
  onApplied,
}: {
  team: TeamMember[];
  onApplied: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [sourceName, setSourceName] = useState("Pasted lead list");
  const [csv, setCsv] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const parsedRows = useMemo(() => parseCsvRows(csv), [csv]);
  const load = useCallback(async () => {
    const data = await crmFetch<{ batches: ImportBatch[] }>("/api/crm/imports/outreach");
    setBatches(data.batches || []);
  }, []);
  useEffect(() => {
    if (open) void load().catch(() => {});
  }, [load, open]);

  const chooseFile = async (file?: File) => {
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError("Export the sheet as CSV first. Excel files are not read directly here.");
      return;
    }
    setError("");
    setSourceName(file.name.slice(0, 240));
    setCsv(await file.text());
  };

  const stage = async () => {
    if (!parsedRows.length) {
      setError("Paste CSV with a header row and at least one lead.");
      return;
    }
    setBusy("stage");
    setError("");
    setNotice("");
    try {
      const data = await crmFetch<{ batch: ImportBatch }>(
        "/api/crm/imports/outreach/stage",
        {
          method: "POST",
          body: JSON.stringify({
            sourceName,
            assignedToUserId: assignedToUserId || null,
            rows: parsedRows,
          }),
        }
      );
      setBatches((current) => [data.batch, ...current.filter((row) => row.id !== data.batch.id)]);
      setNotice(
        `${data.batch.ready_count} clean rows are ready. ${data.batch.duplicate_count + data.batch.review_count + data.batch.invalid_count} rows will stay out.`
      );
    } catch (err: any) {
      setError(err?.message || "The list could not be staged");
    } finally {
      setBusy("");
    }
  };

  const apply = async (batch: ImportBatch) => {
    setBusy(`apply:${batch.id}`);
    setError("");
    setNotice("");
    try {
      const data = await crmFetch<{ result: Record<string, any> }>(
        `/api/crm/imports/outreach/${batch.id}/apply`,
        { method: "POST", body: JSON.stringify({ confirmed: true }) }
      );
      setNotice(
        `${Number(data.result?.inserted || 0)} clean leads were imported. Nothing was contacted or researched.`
      );
      await Promise.all([load(), Promise.resolve(onApplied())]);
    } catch (err: any) {
      setError(err?.message || "The staged list could not be applied");
    } finally {
      setBusy("");
    }
  };

  const undo = async (batch: ImportBatch) => {
    setBusy(`undo:${batch.id}`);
    setError("");
    setNotice("");
    try {
      const data = await crmFetch<{ result: Record<string, any> }>(
        `/api/crm/imports/outreach/${batch.id}/undo`,
        { method: "POST", body: JSON.stringify({ confirmed: true }) }
      );
      setNotice(
        `${Number(data.result?.removed || 0)} untouched imported leads were removed. ${Number(data.result?.protected || 0)} changed leads were protected.`
      );
      await Promise.all([load(), Promise.resolve(onApplied())]);
    } catch (err: any) {
      setError(err?.message || "The import could not be undone");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="mb-3 rounded-xl border border-amber/40 bg-amber/[0.05] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[0.52rem] uppercase tracking-[0.18em] text-amber">
            Owner clean import
          </p>
          <h2 className="mt-1 font-display text-base text-bone">Stage a lead list before it enters Outreach</h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            Exact email duplicates, invalid rows and missing companies stay out. Applying never starts research or contact.
          </p>
        </div>
        <button type="button" onClick={() => setOpen((value) => !value)} className={button}>
          {open ? "Close importer" : "Import CSV"}
        </button>
      </div>

      {open ? (
        <div className="mt-4 space-y-3 border-t border-edge pt-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Source</span>
              <input className={input} value={sourceName} onChange={(event) => setSourceName(event.target.value)} maxLength={240} />
            </label>
            <label>
              <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Assign clean rows to</span>
              <select className={input} value={assignedToUserId} onChange={(event) => setAssignedToUserId(event.target.value)}>
                <option value="">Leave unassigned</option>
                {team.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">CSV file</span>
            <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => void chooseFile(event.target.files?.[0])} className={`${input} file:mr-3 file:rounded file:border-0 file:bg-amber/15 file:px-3 file:py-1 file:text-amber`} />
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Or paste CSV</span>
            <textarea className={`${input} min-h-32 font-mono text-xs`} value={csv} onChange={(event) => setCsv(event.target.value)} placeholder={'Email,First Name,Last Name,Company,Status\npat@example.com,Pat,Smith,Example Ltd,not contacted'} />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">{parsedRows.length ? `${parsedRows.length} rows detected. Maximum 500 per batch.` : "A header row is required."}</p>
            <button type="button" onClick={stage} disabled={!!busy || !parsedRows.length} className={primary}>{busy === "stage" ? "Checking…" : "Stage and check"}</button>
          </div>

          {notice ? <p className="rounded-lg border border-moss/40 bg-moss/10 px-3 py-2 text-sm text-moss">{notice}</p> : null}
          {error ? <p className="rounded-lg border border-rust/45 bg-rust/10 px-3 py-2 text-sm text-rust">{error}</p> : null}

          {batches.map((batch) => {
            const assignee = team.find((member) => member.userId === batch.assigned_to_user_id)?.name || "Unassigned";
            const preview = Array.isArray(batch.rows) ? batch.rows.slice(0, 12) : [];
            const canUndo = batch.status === "applied" && batch.applied_at && Date.now() - new Date(batch.applied_at).getTime() <= 10 * 60 * 1000;
            return (
              <details key={batch.id} className="rounded-lg border border-edge bg-ink/35 p-3" open={batch.status === "staged"}>
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm text-bone">{batch.source_name}</p>
                      <p className="mt-1 text-xs text-muted">{batch.ready_count} ready · {batch.duplicate_count} duplicate · {batch.review_count} review · {batch.invalid_count} invalid · {assignee}</p>
                    </div>
                    <span className="rounded-full border border-edge px-2 py-1 font-mono text-[0.48rem] uppercase text-muted">{batch.status}</span>
                  </div>
                </summary>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-xs">
                    <thead className="font-mono uppercase text-muted"><tr><th className="pb-2">Row</th><th className="pb-2">Person</th><th className="pb-2">Email</th><th className="pb-2">Company</th><th className="pb-2">Decision</th></tr></thead>
                    <tbody className="divide-y divide-edge">
                      {preview.map((row) => <tr key={`${row.rowNumber}:${row.email}`}><td className="py-2 text-muted">{row.rowNumber}</td><td className="py-2 text-bone/80">{[row.firstName, row.lastName].filter(Boolean).join(" ") || "Name missing"}</td><td className="py-2 text-bone/80">{row.email || "Invalid"}</td><td className="py-2 text-bone/80">{row.companyName || "Missing"}</td><td className={`py-2 ${row.decision === "ready" ? "text-moss" : row.decision === "duplicate" ? "text-sky" : "text-rust"}`}>{row.reason}</td></tr>)}
                    </tbody>
                  </table>
                  {batch.row_count > preview.length ? <p className="mt-2 text-xs text-muted">Showing the first {preview.length} of {batch.row_count} rows.</p> : null}
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {batch.status === "staged" ? <button type="button" onClick={() => void apply(batch)} disabled={!!busy || batch.ready_count === 0} className={primary}>{busy === `apply:${batch.id}` ? "Applying…" : `Import ${batch.ready_count} clean rows`}</button> : null}
                  {canUndo ? <button type="button" onClick={() => void undo(batch)} disabled={!!busy} className={button}>{busy === `undo:${batch.id}` ? "Undoing…" : "Undo untouched rows"}</button> : null}
                </div>
              </details>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
