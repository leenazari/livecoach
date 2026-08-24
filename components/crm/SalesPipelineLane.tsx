"use client";

import Link from "next/link";
import { PIPELINE_STAGES } from "@/lib/opportunity-fields";
import type {
  WorkPipelineDeal,
  WorkPipelineSummary,
} from "@/lib/work-inbox";

type Props = {
  pipeline: WorkPipelineSummary;
  busyId: string;
  editingId: string;
  actionText: string;
  actionDue: string;
  minimumDueDate: string;
  stageDrafts: Record<string, string>;
  onBeginAction: (deal: WorkPipelineDeal) => void;
  onCancelAction: () => void;
  onActionTextChange: (value: string) => void;
  onActionDueChange: (value: string) => void;
  onSaveAction: (deal: WorkPipelineDeal) => void;
  onStageChange: (deal: WorkPipelineDeal, stage: string) => void;
  onShowAll: () => void;
};

const OPEN_STAGES = PIPELINE_STAGES.filter(
  (stage) => !["won", "lost"].includes(stage)
);

const label = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const GBP_FORMATTER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const gbp = (value: number) => GBP_FORMATTER.format(value || 0);

const when = (value: string | null) => {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
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

export default function SalesPipelineLane({
  pipeline,
  busyId,
  editingId,
  actionText,
  actionDue,
  minimumDueDate,
  stageDrafts,
  onBeginAction,
  onCancelAction,
  onActionTextChange,
  onActionDueChange,
  onSaveAction,
  onStageChange,
  onShowAll,
}: Props) {
  const topDeals = pipeline.deals.slice(0, 5);

  return (
    <section
      aria-labelledby="sales-pipeline-heading"
      className="rounded-xl border border-moss/40 bg-moss/[0.04] p-3 sm:p-4"
      style={{ contentVisibility: "auto", containIntrinsicSize: "520px" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <p className="font-mono text-[0.5rem] uppercase tracking-wider text-moss">
            Live pipeline
          </p>
          <h2
            id="sales-pipeline-heading"
            className="mt-1 font-display text-lg text-bone"
          >
            Move active deals before finding more leads
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            Your assigned deals, their real stage and the one dated move that
            advances each conversation.
          </p>
        </div>
        <Link
          href="/crm/revenue"
          className="inline-flex min-h-10 items-center rounded-lg border border-moss/45 bg-moss/10 px-3 font-mono text-[0.5rem] uppercase tracking-wider text-moss"
        >
          Table and Kanban ↗
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Open deals", pipeline.totalDeals, "text-bone"],
          ["Recorded value", gbp(pipeline.totalValue), "text-moss"],
          ["Overdue moves", pipeline.overdue, pipeline.overdue ? "text-rust" : "text-muted"],
          ["At risk", pipeline.atRisk, pipeline.atRisk ? "text-rust" : "text-muted"],
        ].map(([metric, value, colour]) => (
          <div key={String(metric)} className="rounded-lg border border-edge bg-ink/35 p-2.5">
            <strong className={`block font-display text-xl ${colour}`}>
              {value}
            </strong>
            <span className="font-mono text-[0.46rem] uppercase tracking-wider text-muted">
              {metric}
            </span>
          </div>
        ))}
      </div>

      <div
        className="mt-3 flex gap-2 overflow-x-auto pb-1"
        aria-label="Assigned deals by pipeline stage"
      >
        {pipeline.stages.map((stage) => (
          <div
            key={stage.key}
            className="min-w-[7.5rem] flex-1 rounded-lg border border-edge bg-panel/45 px-2.5 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[0.46rem] uppercase tracking-wider text-muted">
                {label(stage.key)}
              </span>
              <strong className="font-display text-lg text-bone">
                {stage.count}
              </strong>
            </div>
            <span className="mt-1 block text-[0.65rem] text-moss">
              {gbp(stage.value)}
            </span>
          </div>
        ))}
      </div>

      {pipeline.missingNextAction ? (
        <p className="mt-3 rounded-lg border border-amber/35 bg-amber/[0.06] px-3 py-2 text-xs leading-5 text-amber">
          {pipeline.missingNextAction} {pipeline.missingNextAction === 1 ? "deal has" : "deals have"} no next action. Set one below so nothing silently stalls.
        </p>
      ) : null}

      {topDeals.length ? (
        <ol className="mt-3 divide-y divide-edge/70 border-t border-edge/70">
          {topDeals.map((deal) => {
            const isEditing = editingId === deal.itemId;
            const stageValue = stageDrafts[deal.id] || deal.stage;
            const stageBusy = busyId === `stage:${deal.id}`;
            return (
              <li key={deal.id} className="py-3 first:pt-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/crm/${deal.companyId}`}
                        className="truncate font-display text-base text-bone hover:text-amber"
                      >
                        {deal.company}
                      </Link>
                      <span
                        className={`rounded-full border px-2 py-0.5 font-mono text-[0.44rem] uppercase tracking-wider ${
                          outlookStyle[deal.outlook] || outlookStyle.not_assessed
                        }`}
                      >
                        {label(deal.outlook)}
                      </span>
                      {deal.value ? (
                        <span className="font-mono text-[0.48rem] uppercase text-moss">
                          {gbp(deal.value)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">
                      {deal.title}
                    </p>
                    <p className={`mt-2 text-sm ${deal.nextAction ? "text-bone" : "text-amber"}`}>
                      {deal.nextAction || "Set the next action for this deal"}
                    </p>
                    <p className={`mt-1 font-mono text-[0.48rem] uppercase tracking-wider ${
                      deal.waitingForBuyer ? "text-sky" : "text-muted"
                    }`}>
                      {deal.waitingForBuyer ? "Waiting for buyer" : "Due"} · {when(deal.nextActionDueAt)}
                    </p>
                  </div>

                  <label className="block">
                    <span className="mb-1 block font-mono text-[0.46rem] uppercase tracking-wider text-muted">
                      Lifecycle stage
                    </span>
                    <select
                      aria-label={`Pipeline stage for ${deal.company}`}
                      value={stageValue}
                      onChange={(event) => onStageChange(deal, event.target.value)}
                      disabled={Boolean(busyId)}
                      className="min-h-11 w-full rounded-lg border border-edge bg-ink px-2.5 font-mono text-[0.5rem] uppercase text-bone outline-none focus:border-moss/60 disabled:opacity-45"
                    >
                      {OPEN_STAGES.map((stage) => (
                        <option key={stage} value={stage}>
                          {label(stage)}
                        </option>
                      ))}
                    </select>
                    {stageBusy ? (
                      <span className="mt-1 block font-mono text-[0.44rem] uppercase text-moss">
                        Saving stage…
                      </span>
                    ) : null}
                  </label>
                </div>

                {isEditing ? (
                  <div className="mt-3 rounded-lg border border-moss/40 bg-ink/35 p-3">
                    <p className="font-mono text-[0.48rem] uppercase tracking-wider text-moss">
                      Save the next move before continuing
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_10rem]">
                      <input
                        autoFocus
                        value={actionText}
                        onChange={(event) => onActionTextChange(event.target.value)}
                        placeholder="The one move that advances this deal"
                        aria-label={`Next action for ${deal.company}`}
                        className="min-h-11 rounded-lg border border-edge bg-ink px-3 text-sm text-bone outline-none focus:border-moss/60"
                      />
                      <input
                        type="date"
                        min={minimumDueDate}
                        value={actionDue}
                        onChange={(event) => onActionDueChange(event.target.value)}
                        aria-label={`Next action due date for ${deal.company}`}
                        className="min-h-11 rounded-lg border border-edge bg-ink px-3 text-sm text-bone outline-none focus:border-moss/60"
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={onCancelAction}
                        disabled={Boolean(busyId)}
                        className="min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.5rem] uppercase text-muted disabled:opacity-40"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => onSaveAction(deal)}
                        disabled={Boolean(busyId) || !actionText.trim() || !actionDue}
                        className="min-h-10 rounded-lg border border-moss/50 bg-moss/10 px-3 font-mono text-[0.5rem] uppercase text-moss disabled:opacity-40"
                      >
                        {busyId === deal.itemId ? "Saving…" : "Save and continue"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Link
                      href={`/crm/${deal.companyId}`}
                      className="inline-flex min-h-10 items-center rounded-lg border border-edge px-3 font-mono text-[0.5rem] uppercase text-muted hover:text-bone"
                    >
                      Open client ↗
                    </Link>
                    <button
                      type="button"
                      onClick={() => onBeginAction(deal)}
                      disabled={Boolean(busyId)}
                      className="min-h-10 rounded-lg border border-moss/50 bg-moss/10 px-3 font-mono text-[0.5rem] uppercase text-moss disabled:opacity-40"
                    >
                      {deal.nextAction ? "Complete move and set next" : "Set next move"}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-edge px-4 py-8 text-center">
          <p className="font-display text-lg text-bone">No assigned deals yet.</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            Interested replies can be qualified and moved into this pipeline without exposing another user’s private records.
          </p>
        </div>
      )}

      {pipeline.totalDeals > topDeals.length ? (
        <button
          type="button"
          onClick={onShowAll}
          className="mt-3 min-h-11 w-full rounded-lg border border-edge font-mono text-[0.52rem] uppercase tracking-wider text-muted hover:border-moss/45 hover:text-moss"
        >
          Work all {pipeline.totalDeals} assigned deals
        </button>
      ) : null}
    </section>
  );
}
