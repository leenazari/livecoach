import Link from "next/link";
import { WIN_OUTLOOK_LABELS, type WinOutlook } from "@/lib/opportunity-fields";

type Assessment = {
  id: string;
  companyId: string | null;
  company: string;
  opportunity: string;
  sourceRecordType: string;
  sourceChannel: string;
  status: string;
  occurredAt: string | null;
  createdAt: string;
  attempts: number;
  error: string | null;
  evidenceSummary: string;
  result: Record<string, any>;
};

export type SignalHealth = {
  windowStart: string;
  auditTarget: number;
  assessedSignals: number;
  costGbp: number;
  counts: Record<"queued" | "processing" | "complete" | "ignored" | "protected" | "failed", number>;
  recentAssessments: Assessment[];
};

const formatLabel = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/London" }).format(new Date(value))
  : "Time not recorded";
const money = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);

const statusTone: Record<string, string> = {
  complete: "border-moss/45 bg-moss/10 text-moss",
  protected: "border-amber/45 bg-amber/10 text-amber",
  failed: "border-rust/50 bg-rust/10 text-rust",
  queued: "border-amber/35 bg-amber/[0.06] text-amber",
  processing: "border-amber/35 bg-amber/[0.06] text-amber",
  ignored: "border-edge bg-ink text-muted",
};

export default function OutlookIntelligencePanel({ health }: { health: SignalHealth }) {
  const progress = Math.min(100, Math.round((health.assessedSignals / Math.max(1, health.auditTarget)) * 100));
  const waiting = health.counts.queued + health.counts.processing;
  const ready = health.assessedSignals >= health.auditTarget;

  return (
    <section className="mb-4 rounded-xl border border-edge bg-panel p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[0.55rem] uppercase tracking-widest text-amber">Outlook intelligence</p>
          <h2 className="mt-1 font-display text-xl text-bone">Check the evidence before increasing automation</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">Only new saved activity is assessed once. This panel reads stored results, so viewing it creates no AI cost.</p>
        </div>
        <span className={`w-fit rounded-full border px-3 py-1.5 font-mono text-[0.52rem] uppercase ${ready ? "border-moss/45 bg-moss/10 text-moss" : "border-amber/40 bg-amber/10 text-amber"}`}>
          {ready ? "Ready for quality review" : `${health.assessedSignals} of ${health.auditTarget} signals to review`}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Assessed", health.assessedSignals, "Evidence classified"],
          ["Human protected", health.counts.protected, "Overrides preserved"],
          ["Waiting or retry", waiting + health.counts.failed, health.counts.failed ? `${health.counts.failed} need retry` : "Nothing stuck"],
          ["AI cost, 7 days", money(health.costGbp), "Exact usage log"],
        ].map(([label, value, note]) => (
          <div key={String(label)} className="rounded-lg border border-edge bg-ink/35 p-3">
            <strong className="block font-display text-xl text-bone">{value}</strong>
            <span className="font-mono text-[0.49rem] uppercase text-muted">{label}</span>
            <p className="mt-1 text-[0.68rem] text-muted">{note}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink">
        <div className="h-full rounded-full bg-amber transition-[width]" style={{ width: `${progress}%` }} />
      </div>

      <details className="mt-3 rounded-lg border border-edge bg-ink/25 p-3">
        <summary className="cursor-pointer font-mono text-[0.55rem] uppercase tracking-wider text-amber">
          Review recent evidence and decisions
        </summary>
        {health.recentAssessments.length ? (
          <div className="mt-3 space-y-2">
            {health.recentAssessments.map((item) => {
              const outlook = item.result?.outlook as WinOutlook | undefined;
              const reason = item.result?.rationale || item.result?.reason || item.error;
              return (
                <article key={item.id} className="rounded-lg border border-edge bg-panel/70 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      {item.companyId ? <Link href={`/crm/${item.companyId}`} className="inline-flex min-h-10 items-center rounded-md font-semibold text-bone transition hover:text-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/70">{item.company}</Link> : <strong className="text-bone">{item.company}</strong>}
                      <p className="text-xs text-muted">{item.opportunity}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-1 font-mono text-[0.48rem] uppercase ${statusTone[item.status] || statusTone.ignored}`}>{formatLabel(item.status)}</span>
                  </div>
                  <p className="mt-2 font-mono text-[0.5rem] uppercase text-muted">{formatLabel(item.sourceRecordType)} · {formatLabel(item.sourceChannel)} · {dateTime(item.occurredAt || item.createdAt)}</p>
                  {outlook ? <p className="mt-2 text-sm text-amber">Outlook: {WIN_OUTLOOK_LABELS[outlook] || formatLabel(outlook)}{Number.isFinite(Number(item.result?.confidence)) ? ` · ${Number(item.result.confidence)}% classification confidence` : ""}</p> : null}
                  <p className="mt-2 text-sm leading-5 text-bone">{item.evidenceSummary}</p>
                  {reason ? <p className="mt-2 text-xs leading-5 text-muted">Why: {reason}</p> : null}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">No fresh commercial evidence has been assessed in the last seven days. There has been no outlook AI spend in this window.</p>
        )}
      </details>
    </section>
  );
}
