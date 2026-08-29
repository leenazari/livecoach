"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PIPELINE_STAGES } from "@/lib/opportunity-fields";
import type { WorkPipelineDeal, WorkPipelineSummary } from "@/lib/work-inbox";
import MetricDrilldown from "@/components/crm/MetricDrilldown";

type Props = {
  pipeline: WorkPipelineSummary;
  busyId: string;
  editingId: string;
  actionText: string;
  actionDue: string;
  minimumDueDate: string;
  stageDrafts: Record<string, string>;
  quickCallId: string;
  quickCallNote: string;
  quickCallOutcome: string;
  quickCallMethod: string;
  onBeginAction: (deal: WorkPipelineDeal) => void;
  onCancelAction: () => void;
  onActionTextChange: (value: string) => void;
  onActionDueChange: (value: string) => void;
  onSaveAction: (deal: WorkPipelineDeal) => void;
  onStageChange: (deal: WorkPipelineDeal, stage: string) => void;
  onBeginQuickCall: (deal: WorkPipelineDeal) => void;
  onCancelQuickCall: () => void;
  onQuickCallNoteChange: (value: string) => void;
  onQuickCallOutcomeChange: (value: string) => void;
  onQuickCallMethodChange: (value: string) => void;
  onSaveQuickCall: (deal: WorkPipelineDeal) => void;
  onDismissDeal: (deal: WorkPipelineDeal) => void;
  onShowAll: () => void;
};

const OPEN_STAGES = PIPELINE_STAGES.filter((stage) => !["won", "lost"].includes(stage));
const label = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const GBP_FORMATTER = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const gbp = (value: number) => GBP_FORMATTER.format(value || 0);
const QUICK_CALL_OUTCOMES = [["connected", "Spoke"], ["voicemail", "Voicemail"], ["no_answer", "No answer"], ["wrong_contact", "Wrong contact"]] as const;
const QUICK_ACTIVITY_METHODS = [["phone", "Phone"], ["in_person", "Face to face"], ["video_call", "Video call"]] as const;

const when = (value: string | null, empty = "No due date") => {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return date.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const outlookStyle: Record<string, string> = {
  at_risk: "border-rust/50 bg-rust/10 text-rust",
  possible: "border-sky/45 bg-sky/[0.08] text-sky",
  likely: "border-sage/45 bg-sage/[0.08] text-sage",
  highly_likely: "border-moss/50 bg-moss/10 text-moss",
  won: "border-moss/50 bg-moss/10 text-moss",
  not_assessed: "border-edge bg-ink/35 text-muted",
};

export default function SalesPipelineLane(props: Props) {
  const {
    pipeline, busyId, editingId, actionText, actionDue, minimumDueDate,
    stageDrafts, quickCallId, quickCallNote, quickCallOutcome, quickCallMethod,
    onBeginAction, onCancelAction, onActionTextChange, onActionDueChange,
    onSaveAction, onStageChange, onBeginQuickCall, onCancelQuickCall,
    onQuickCallNoteChange, onQuickCallOutcomeChange, onQuickCallMethodChange,
    onSaveQuickCall, onDismissDeal, onShowAll,
  } = props;
  const [confirmDismissId, setConfirmDismissId] = useState("");
  const companyGroups = useMemo(() => {
    const groups = new Map<string, { companyId: string; company: string; deals: WorkPipelineDeal[] }>();
    for (const deal of pipeline.deals) {
      const existing = groups.get(deal.companyId);
      if (existing) existing.deals.push(deal);
      else groups.set(deal.companyId, { companyId: deal.companyId, company: deal.company, deals: [deal] });
    }
    return [...groups.values()];
  }, [pipeline.deals]);
  const shownGroups = companyGroups.slice(0, 5);

  return (
    <section aria-labelledby="sales-pipeline-heading" className="rounded-xl border border-moss/40 bg-moss/[0.04] p-3 sm:p-4" style={{ contentVisibility: "auto", containIntrinsicSize: "650px" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <p className="font-mono text-[0.5rem] uppercase tracking-wider text-moss">Live pipeline</p>
          <h2 id="sales-pipeline-heading" className="mt-1 font-display text-lg text-bone">Move active deals before finding more leads</h2>
          <p className="mt-1 text-xs leading-5 text-muted">Each client appears once. Expand its genuine deal threads, edit the live sales state, or remove an incorrect deal while keeping its history.</p>
        </div>
        <Link href="/crm/revenue" className="inline-flex min-h-10 items-center rounded-lg border border-moss/45 bg-moss/10 px-3 font-mono text-[0.5rem] uppercase tracking-wider text-moss">Full Table and Kanban ↗</Link>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Clients", companyGroups.length, "text-bone", "/crm/revenue?view=raw"],
          ["Recorded value", gbp(pipeline.totalValue), "text-moss", "/crm/revenue?view=raw"],
          ["Overdue moves", pipeline.overdue, pipeline.overdue ? "text-rust" : "text-muted", "/crm/revenue?view=overdue"],
          ["At risk", pipeline.atRisk, pipeline.atRisk ? "text-rust" : "text-muted", "/crm/revenue?view=at_risk"],
        ].map(([metric, value, colour, href]) => (
          <MetricDrilldown key={String(metric)} label={String(metric)} value={value} valueClassName={String(colour)} href={String(href)} compact />
        ))}
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Assigned deals by pipeline stage">
        {pipeline.stages.map((stage) => (
          <MetricDrilldown key={stage.key} label={label(stage.key)} value={stage.count} note={gbp(stage.value)} href={`/crm/revenue?view=stage-${stage.key}`} compact className="min-w-[7.5rem] flex-1 bg-panel/45" />
        ))}
      </div>

      {pipeline.missingNextAction ? <p className="mt-3 rounded-lg border border-amber/35 bg-amber/[0.06] px-3 py-2 text-xs leading-5 text-amber">{pipeline.missingNextAction} {pipeline.missingNextAction === 1 ? "deal has" : "deals have"} no next action. Set one below so nothing silently stalls.</p> : null}

      {shownGroups.length ? (
        <div className="mt-3 space-y-3">
          {shownGroups.map((group) => (
            <section key={group.companyId} className="rounded-xl border border-edge bg-panel/35 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge/70 pb-2">
                <Link href={`/crm/${group.companyId}`} className="font-display text-lg text-bone hover:text-amber">{group.company}</Link>
                <span className="rounded-full border border-edge px-2 py-1 font-mono text-[0.46rem] uppercase text-muted">{group.deals.length} {group.deals.length === 1 ? "deal thread" : "distinct deal threads"}</span>
              </div>
              <div className="divide-y divide-edge/70">
                {group.deals.map((deal) => {
                  const isEditing = editingId === deal.itemId;
                  const isLoggingCall = quickCallId === deal.id;
                  const stageValue = stageDrafts[deal.id] || deal.stage;
                  const removing = confirmDismissId === deal.id;
                  return (
                    <article key={deal.id} className="py-3 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-bone">{deal.title}</strong><span className={`rounded-full border px-2 py-0.5 font-mono text-[0.44rem] uppercase tracking-wider ${outlookStyle[deal.outlook] || outlookStyle.not_assessed}`}>{label(deal.outlook)}</span>{deal.value ? <span className="font-mono text-[0.48rem] uppercase text-moss">{gbp(deal.value)}</span> : null}</div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-[0.7rem] sm:grid-cols-4"><p><span className="block font-mono text-[0.43rem] uppercase text-muted">Stage</span><span className="text-bone">{label(deal.stage)}</span></p><p><span className="block font-mono text-[0.43rem] uppercase text-muted">Engagement</span><span className="text-bone">{deal.engagementMotion ? label(deal.engagementMotion) : "Not set"}</span></p><p><span className="block font-mono text-[0.43rem] uppercase text-muted">Contact</span><span className="text-bone">{deal.activeContactMethod ? label(deal.activeContactMethod) : "Not set"}</span></p><p><span className="block font-mono text-[0.43rem] uppercase text-muted">Last activity</span><span className="text-bone">{when(deal.lastMeaningfulActivityAt, "Not recorded")}</span></p></div>
                          <p className={`mt-2 text-sm ${deal.nextAction ? "text-bone" : "text-amber"}`}>{deal.nextAction || "Set the next action for this deal"}</p>
                          <p className={`mt-1 font-mono text-[0.46rem] uppercase tracking-wider ${deal.waitingForBuyer ? "text-sky" : "text-muted"}`}>{deal.waitingForBuyer ? "Waiting for buyer" : "Due"} · {when(deal.nextActionDueAt)}</p>
                          {deal.stageProtected || deal.nextActionProtected ? <p className="mt-1 font-mono text-[0.43rem] uppercase tracking-wider text-sky">Human override protects {[deal.stageProtected ? "stage" : "", deal.nextActionProtected ? "next action" : ""].filter(Boolean).join(" and ")}</p> : null}
                        </div>
                        <label className="w-full sm:w-40"><span className="mb-1 block font-mono text-[0.44rem] uppercase text-muted">Lifecycle stage</span><select aria-label={`Pipeline stage for ${deal.title}`} value={stageValue} onChange={(event) => onStageChange(deal, event.target.value)} disabled={Boolean(busyId)} className="min-h-10 w-full rounded-lg border border-edge bg-ink px-2 font-mono text-[0.48rem] uppercase text-bone outline-none focus:border-moss/60 disabled:opacity-45">{OPEN_STAGES.map((stage) => <option key={stage} value={stage}>{label(stage)}</option>)}</select></label>
                      </div>

                      {isLoggingCall ? (
                        <div className="mt-3 rounded-lg border border-amber/40 bg-amber/[0.05] p-3">
                          <p className="font-mono text-[0.48rem] uppercase tracking-wider text-amber">Quick activity note</p>
                          <div className="mt-2 flex flex-wrap gap-2">{QUICK_ACTIVITY_METHODS.map(([value, text]) => <button key={value} type="button" onClick={() => onQuickCallMethodChange(value)} disabled={Boolean(busyId)} className={`min-h-9 rounded-full border px-3 font-mono text-[0.48rem] uppercase ${quickCallMethod === value ? "border-sky/60 bg-sky/15 text-sky" : "border-edge text-muted"}`}>{text}</button>)}</div>
                          <div className="mt-2 flex flex-wrap gap-2">{QUICK_CALL_OUTCOMES.map(([value, text]) => <button key={value} type="button" onClick={() => onQuickCallOutcomeChange(value)} disabled={Boolean(busyId)} className={`min-h-9 rounded-full border px-3 font-mono text-[0.48rem] uppercase ${quickCallOutcome === value ? "border-amber/60 bg-amber/20 text-amber" : "border-edge text-muted"}`}>{text}</button>)}</div>
                          <textarea autoFocus rows={4} maxLength={1600} value={quickCallNote} onChange={(event) => onQuickCallNoteChange(event.target.value)} placeholder="What happened, what they need, what was agreed and what happens next" aria-label={`Activity note for ${group.company}`} className="mt-2 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm leading-6 text-bone outline-none focus:border-amber/60" />
                          <p className="mt-1 text-xs leading-5 text-muted">The note is timestamped on this deal. LiveCoach suggests one next action and stage without overwriting your manual choices.</p>
                          <div className="mt-2 flex flex-wrap justify-end gap-2"><button type="button" onClick={onCancelQuickCall} disabled={Boolean(busyId)} className="min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.5rem] uppercase text-muted disabled:opacity-40">Cancel</button><button type="button" onClick={() => onSaveQuickCall(deal)} disabled={Boolean(busyId) || quickCallNote.trim().length < 3} className="min-h-10 rounded-lg border border-amber/55 bg-amber/15 px-3 font-mono text-[0.5rem] uppercase text-amber disabled:opacity-40">{busyId === `call:${deal.id}` ? "Saving note…" : "Save activity and update deal"}</button></div>
                        </div>
                      ) : isEditing ? (
                        <div className="mt-3 rounded-lg border border-moss/40 bg-ink/35 p-3"><p className="font-mono text-[0.48rem] uppercase tracking-wider text-moss">Save the next move before continuing</p><div className="mt-2 grid gap-2 sm:grid-cols-[1fr_10rem]"><input autoFocus value={actionText} onChange={(event) => onActionTextChange(event.target.value)} placeholder="The one move that advances this deal" className="min-h-11 rounded-lg border border-edge bg-ink px-3 text-sm text-bone outline-none focus:border-moss/60" /><input type="date" min={minimumDueDate} value={actionDue} onChange={(event) => onActionDueChange(event.target.value)} className="min-h-11 rounded-lg border border-edge bg-ink px-3 text-sm text-bone outline-none focus:border-moss/60" /></div><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={onCancelAction} disabled={Boolean(busyId)} className="min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.5rem] uppercase text-muted">Cancel</button><button type="button" onClick={() => onSaveAction(deal)} disabled={Boolean(busyId) || !actionText.trim() || !actionDue} className="min-h-10 rounded-lg border border-moss/50 bg-moss/10 px-3 font-mono text-[0.5rem] uppercase text-moss disabled:opacity-40">{busyId === deal.itemId ? "Saving…" : "Save and continue"}</button></div></div>
                      ) : removing ? (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rust/45 bg-rust/[0.07] p-3"><p className="text-xs leading-5 text-bone">Remove this deal from the active pipeline. Its client, calls and change history stay saved.</p><div className="flex gap-2"><button type="button" onClick={() => setConfirmDismissId("")} className="min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.48rem] uppercase text-muted">Keep it</button><button type="button" onClick={() => { setConfirmDismissId(""); onDismissDeal(deal); }} disabled={Boolean(busyId)} className="min-h-10 rounded-lg border border-rust/55 bg-rust/15 px-3 font-mono text-[0.48rem] uppercase text-rust disabled:opacity-40">{busyId === `dismiss:${deal.id}` ? "Removing…" : "Remove deal"}</button></div></div>
                      ) : (
                        <div className="mt-3 flex flex-wrap justify-end gap-2"><Link href={`/crm/${deal.companyId}`} className="inline-flex min-h-10 items-center rounded-lg border border-edge px-3 font-mono text-[0.48rem] uppercase text-muted hover:text-bone">Open client ↗</Link><button type="button" onClick={() => onBeginQuickCall(deal)} disabled={Boolean(busyId)} className="min-h-10 rounded-lg border border-amber/50 bg-amber/10 px-3 font-mono text-[0.48rem] uppercase text-amber disabled:opacity-40">Log activity</button><button type="button" onClick={() => onBeginAction(deal)} disabled={Boolean(busyId)} className="min-h-10 rounded-lg border border-moss/50 bg-moss/10 px-3 font-mono text-[0.48rem] uppercase text-moss disabled:opacity-40">{deal.nextAction ? "Complete move and set next" : "Set next move"}</button><button type="button" onClick={() => setConfirmDismissId(deal.id)} disabled={Boolean(busyId)} className="min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.48rem] uppercase text-muted hover:border-rust/45 hover:text-rust disabled:opacity-40">Remove from pipeline</button></div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : <div className="mt-3 rounded-lg border border-dashed border-edge px-4 py-8 text-center"><p className="font-display text-lg text-bone">No assigned deals yet.</p><p className="mt-1 text-xs leading-5 text-muted">Interested replies can be qualified and moved into this pipeline without exposing another user’s private records.</p></div>}

      {companyGroups.length > shownGroups.length ? <button type="button" onClick={onShowAll} className="mt-3 min-h-11 w-full rounded-lg border border-edge font-mono text-[0.52rem] uppercase tracking-wider text-muted hover:border-moss/45 hover:text-moss">Work all {pipeline.totalDeals} deals across {companyGroups.length} clients</button> : null}
    </section>
  );
}
