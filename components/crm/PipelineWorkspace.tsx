"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CONTACT_METHODS,
  ENGAGEMENT_MOTIONS,
  WIN_OUTLOOK_LABELS,
  WIN_OUTLOOKS,
  type WinOutlook,
} from "@/lib/opportunity-fields";
import { crmFetch } from "@/lib/crm";

type Row = Record<string, any> & {
  id: string;
  company_id: string;
  company: string;
  title: string;
  pipeline_stage: string;
  win_outlook: WinOutlook;
  value: number;
  nextAction: string;
  next_action: string | null;
  next_action_due_at: string | null;
  nextMeetingAt: string | null;
  lastMeaningfulActivityAt: string | null;
  risks: { code: string; label: string; severity: "high" | "medium" }[];
  outlookQuestions: string[];
  priorityReasons: string[];
};

type Props = {
  rows: Row[];
  stageDefinitions: { key: string; label: string }[];
  busy: string;
  onChange: (id: string, patch: Partial<Row>) => void;
  onSave: (row: Row) => void;
};

const input = "min-h-10 w-full rounded-lg border border-edge bg-ink/70 px-2.5 py-2 text-sm text-bone outline-none focus:border-amber/60";
const formatLabel = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const gbp = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value || 0);
const dateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/London" }).format(new Date(value))
  : "Not recorded";

const outlookTone: Record<WinOutlook, string> = {
  not_assessed: "border-edge bg-ink text-muted",
  at_risk: "border-rust/50 bg-rust/10 text-rust",
  possible: "border-amber/45 bg-amber/10 text-amber",
  likely: "border-moss/45 bg-moss/10 text-moss",
  highly_likely: "border-moss/60 bg-moss/20 text-moss",
  won: "border-moss/70 bg-moss/25 text-moss",
};

function DealDetails({ row, stageDefinitions, busy, onChange, onSave }: Props & { row: Row }) {
  const reasons = Array.isArray(row.win_outlook_reasons) ? row.win_outlook_reasons : [];
  const questions = Array.isArray(row.outlookQuestions) ? row.outlookQuestions : [];
  const [history, setHistory] = useState<Record<string, any>[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const loadHistory = async () => {
    if (history) return;
    setHistoryError("");
    try {
      const result = await crmFetch<{ events: Record<string, any>[] }>(`/api/crm/opportunities/${row.id}/events`);
      setHistory(result.events || []);
    } catch (error: any) {
      setHistoryError(error?.message || "Could not load the change history");
    }
  };
  return (
    <details className="mt-2 rounded-lg border border-edge bg-ink/35 p-2">
      <summary className="cursor-pointer font-mono text-[0.56rem] uppercase tracking-wider text-amber">
        Evidence and edit
      </summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="lg:col-span-2">
          <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Deal intent</span>
          <textarea className={`${input} min-h-20 resize-y`} value={row.deal_intent || ""} onChange={(event) => onChange(row.id, { deal_intent: event.target.value })} placeholder="The commercial outcome this deal is pursuing" />
        </label>
        <label>
          <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Lifecycle stage</span>
          <select className={input} value={row.pipeline_stage} onChange={(event) => onChange(row.id, { pipeline_stage: event.target.value })}>
            {stageDefinitions.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Win outlook</span>
          <select className={input} value={row.win_outlook || "not_assessed"} onChange={(event) => onChange(row.id, { win_outlook: event.target.value as WinOutlook })}>
            {WIN_OUTLOOKS.map((value) => <option key={value} value={value}>{WIN_OUTLOOK_LABELS[value]}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Outlook confidence</span>
          <input type="number" min="0" max="100" className={input} value={row.win_outlook_confidence ?? ""} onChange={(event) => onChange(row.id, { win_outlook_confidence: event.target.value === "" ? null : Math.min(100, Math.max(0, Number(event.target.value))) })} placeholder="Not assessed" />
        </label>
        <label>
          <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Engagement motion</span>
          <select className={input} value={row.engagement_motion || ""} onChange={(event) => onChange(row.id, { engagement_motion: event.target.value || null })}>
            <option value="">Not set</option>
            {ENGAGEMENT_MOTIONS.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Active contact method</span>
          <select className={input} value={row.active_contact_method || ""} onChange={(event) => onChange(row.id, { active_contact_method: event.target.value || null })}>
            <option value="">Not set</option>
            {CONTACT_METHODS.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Value</span>
          <input type="number" min="0" className={input} value={Number.isNaN(row.value) ? "" : row.value} onChange={(event) => onChange(row.id, { value: event.target.value === "" ? Number.NaN : Number(event.target.value) })} />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Outlook evidence, one point per line</span>
          <textarea className={`${input} min-h-20 resize-y`} value={reasons.join("\n")} onChange={(event) => onChange(row.id, { win_outlook_reasons: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} placeholder="Only evidence already held in the CRM" />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block font-mono text-[0.5rem] uppercase text-amber">Primary next action</span>
          <input className={input} value={row.next_action ?? row.nextAction ?? ""} onChange={(event) => onChange(row.id, { next_action: event.target.value })} placeholder="One action that progresses the deal" />
        </label>
        <label>
          <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Action due</span>
          <input type="date" className={input} value={row.next_action_due_at?.slice(0, 10) || ""} onChange={(event) => onChange(row.id, { next_action_due_at: event.target.value || null })} />
        </label>
        <label>
          <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Manual probability</span>
          <input type="number" min="0" max="100" className={input} value={Number.isNaN(row.probability) ? "" : row.probability} onChange={(event) => onChange(row.id, { probability: event.target.value === "" ? Number.NaN : Math.min(100, Math.max(0, Number(event.target.value))) })} />
        </label>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded-lg border border-edge bg-panel/60 p-3">
          <p className="font-mono text-[0.52rem] uppercase text-muted">Evidence retained</p>
          {reasons.length ? <ul className="mt-2 space-y-1 text-sm text-bone">{reasons.map((reason: string) => <li key={reason}>• {reason}</li>)}</ul> : <p className="mt-2 text-sm text-muted">No evidence has been recorded yet.</p>}
        </div>
        <div className="rounded-lg border border-amber/30 bg-amber/[0.05] p-3">
          <p className="font-mono text-[0.52rem] uppercase text-amber">Ask next, do not guess</p>
          {questions.length ? <ul className="mt-2 space-y-1 text-sm text-bone">{questions.map((question) => <li key={question}>• {question}</li>)}</ul> : <p className="mt-2 text-sm text-muted">No evidence gaps are currently flagged.</p>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted">
          {row.win_outlook_override ? <span className="text-amber">Human override active</span> : "System outlook can update from new stored evidence"}
          {row.win_outlook_as_of ? ` · assessed ${dateTime(row.win_outlook_as_of)}` : ""}
        </div>
        <button onClick={() => onSave(row)} disabled={!!busy} className="min-h-10 rounded-lg border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.57rem] uppercase text-amber disabled:opacity-40">
          {busy === `opp:${row.id}` ? "Saving…" : "Save confirmed changes"}
        </button>
      </div>
      <div className="mt-3 border-t border-edge pt-3">
        <button type="button" onClick={loadHistory} className="font-mono text-[0.53rem] uppercase text-muted hover:text-amber">
          {history ? "Change history" : "Load change history"}
        </button>
        {historyError ? <p className="mt-2 text-xs text-rust">{historyError}</p> : null}
        {history ? <div className="mt-2 space-y-2">{history.length ? history.slice(0, 8).map((event) => <div key={event.id} className="rounded-lg border border-edge bg-panel/50 p-2 text-xs"><div className="flex flex-wrap justify-between gap-2"><strong className="text-bone">{formatLabel(event.event_type)}</strong><span className="text-muted">{dateTime(event.created_at)} · {event.source_type === "human" ? "Human" : "System"} · {formatLabel(event.source_channel || "database")}</span></div>{event.rationale ? <p className="mt-1 text-muted">{event.rationale}</p> : null}</div>) : <p className="text-xs text-muted">No changes have been recorded since history tracking began.</p>}</div> : null}
      </div>
    </details>
  );
}

function OutlookBadge({ row }: { row: Row }) {
  const outlook = (row.win_outlook || "not_assessed") as WinOutlook;
  return <span className={`inline-flex rounded-full border px-2 py-1 font-mono text-[0.5rem] uppercase ${outlookTone[outlook]}`}>{WIN_OUTLOOK_LABELS[outlook]}{row.win_outlook_override ? " · human" : ""}</span>;
}

export default function PipelineWorkspace(props: Props) {
  const { rows, stageDefinitions } = props;
  const [view, setView] = useState<"table" | "kanban">("table");
  const stats = useMemo(() => ({
    overdue: rows.filter((row) => row.risks.some((risk) => risk.code === "next_action_overdue" || risk.code === "overdue_actions")).length,
    meetings: rows.filter((row) => row.nextMeetingAt && new Date(row.nextMeetingAt).getTime() <= Date.now() + 3 * 86400000).length,
    atRisk: rows.filter((row) => row.win_outlook === "at_risk").length,
    stalled: rows.filter((row) => Number(row.daysQuiet) >= 14).length,
  }), [rows]);

  return (
    <section className="mb-4 rounded-xl border border-amber/30 bg-panel p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="font-mono text-[0.55rem] uppercase tracking-widest text-amber">Pipeline operating view</p>
          <h2 className="mt-1 font-display text-xl text-bone">What needs attention now</h2>
          <p className="mt-1 text-sm text-muted">Lifecycle shows where the deal is. Win outlook shows the evidence-led chance of winning it.</p>
        </div>
        <div className="flex rounded-lg border border-edge bg-ink p-1">
          {(["table", "kanban"] as const).map((value) => <button key={value} onClick={() => setView(value)} className={`min-h-9 rounded-md px-3 font-mono text-[0.56rem] uppercase ${view === value ? "bg-amber/20 text-amber" : "text-muted"}`}>{value}</button>)}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Overdue", stats.overdue, "text-rust"], ["Meetings soon", stats.meetings, "text-amber"], ["At risk", stats.atRisk, "text-rust"], ["Stalled", stats.stalled, "text-muted"]].map(([label, value, tone]) => <div key={String(label)} className="rounded-lg border border-edge bg-ink/40 p-2.5"><strong className={`block font-display text-xl ${tone}`}>{value}</strong><span className="font-mono text-[0.49rem] uppercase text-muted">{label}</span></div>)}
      </div>

      {view === "table" ? (
        <>
          <div className="mt-3 space-y-2 md:hidden">
            {rows.map((row) => <article key={row.id} className="rounded-xl border border-edge bg-ink/35 p-3">
              <div className="flex items-start justify-between gap-2"><div><Link href={`/crm/${row.company_id}`} className="font-display text-lg text-bone hover:text-amber">{row.company}</Link><p className="text-sm text-muted">{row.title}</p></div><OutlookBadge row={row} /></div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><span className="block font-mono text-[0.48rem] uppercase text-muted">Stage</span><strong className="text-bone">{formatLabel(row.pipeline_stage)}</strong></div><div><span className="block font-mono text-[0.48rem] uppercase text-muted">Value</span><strong className="text-bone">{gbp(row.value)}</strong></div><div><span className="block font-mono text-[0.48rem] uppercase text-muted">Motion</span><strong className="text-bone">{row.engagement_motion ? formatLabel(row.engagement_motion) : "Not set"}</strong></div><div><span className="block font-mono text-[0.48rem] uppercase text-muted">Last activity</span><strong className="text-bone">{dateTime(row.lastMeaningfulActivityAt)}</strong></div></div>
              <p className="mt-3 rounded-lg border border-amber/25 bg-amber/[0.05] p-2 text-sm text-amber">{row.next_action || row.nextAction}</p>
              <DealDetails {...props} row={row} />
            </article>)}
          </div>
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px] border-separate border-spacing-y-2 text-left">
              <thead><tr className="font-mono text-[0.5rem] uppercase text-muted"><th className="px-2">Deal</th><th className="px-2">Stage</th><th className="px-2">Win outlook</th><th className="px-2">Value</th><th className="px-2">Engagement</th><th className="px-2">Last activity</th><th className="px-2">Next action</th></tr></thead>
              <tbody>{rows.map((row) => <tr key={row.id} className="align-top [&>td]:border-y [&>td]:border-edge [&>td]:bg-ink/35 [&>td]:p-2 first:[&>td]:rounded-l-lg last:[&>td]:rounded-r-lg"><td className="w-52 border-l"><Link href={`/crm/${row.company_id}`} className="font-display text-bone hover:text-amber">{row.company}</Link><p className="max-w-52 text-xs text-muted">{row.title}</p>{row.priorityReasons?.length ? <p className="mt-1 text-[0.67rem] text-amber">{row.priorityReasons.slice(0, 2).join(" · ")}</p> : null}</td><td><span className="text-sm text-bone">{formatLabel(row.pipeline_stage)}</span></td><td><OutlookBadge row={row} /></td><td className="text-sm text-bone">{gbp(row.value)}</td><td className="max-w-36 text-xs text-bone">{row.engagement_motion ? formatLabel(row.engagement_motion) : "Not set"}<span className="mt-1 block text-muted">{row.active_contact_method ? formatLabel(row.active_contact_method) : "Method not set"}</span></td><td className="text-xs text-bone">{dateTime(row.lastMeaningfulActivityAt)}{row.nextMeetingAt ? <span className="mt-1 block text-amber">Meeting {dateTime(row.nextMeetingAt)}</span> : null}</td><td className="w-72"><p className="text-sm text-amber">{row.next_action || row.nextAction}</p><p className="mt-1 text-xs text-muted">{row.next_action_due_at ? `Due ${dateTime(row.next_action_due_at)}` : "No due date"}</p><DealDetails {...props} row={row} /></td></tr>)}</tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
          {stageDefinitions.filter((stage) => !["won", "lost"].includes(stage.key)).map((stage) => {
            const members = rows.filter((row) => row.pipeline_stage === stage.key);
            return <section key={stage.key} className="w-[280px] shrink-0 rounded-xl border border-edge bg-ink/30 p-2.5"><div className="mb-2 flex items-center justify-between"><h3 className="font-mono text-[0.58rem] uppercase text-bone">{stage.label}</h3><span className="rounded-full bg-panel px-2 py-1 text-xs text-muted">{members.length}</span></div><div className="space-y-2">{members.length ? members.map((row) => <article key={row.id} className="rounded-lg border border-edge bg-panel p-3"><div className="flex items-start justify-between gap-2"><Link href={`/crm/${row.company_id}`} className="font-display text-bone hover:text-amber">{row.company}</Link><span className="text-xs text-muted">{gbp(row.value)}</span></div><p className="mt-1 text-xs text-muted">{row.title}</p><div className="mt-2"><OutlookBadge row={row} /></div><p className="mt-2 text-sm text-amber">{row.next_action || row.nextAction}</p>{row.next_action_due_at ? <p className="mt-1 text-xs text-muted">Due {dateTime(row.next_action_due_at)}</p> : null}<DealDetails {...props} row={row} /></article>) : <p className="rounded-lg border border-dashed border-edge p-3 text-center text-xs text-muted">No deals</p>}</div></section>;
          })}
        </div>
      )}
    </section>
  );
}
