"use client";

import type { CostBreakdown } from "@/lib/costs";

// Compact, always-visible live cost meter. Shows running session cost and the
// projected hourly pace, turning rust when the pace crosses the ceiling. Hover
// for the per-component breakdown (incl. the transport line — LiveKit or
// Recall.ai — depending on the call type).
export default function CostMeter({
  cost,
  overBudget,
  projectedHourly,
  transportLabel = "Transport",
}: {
  cost: CostBreakdown | null;
  overBudget: boolean;
  projectedHourly?: number;
  transportLabel?: string;
}) {
  if (!cost) return null;

  const gbp = (n: number) => `£${n.toFixed(2)}`;
  const gbp3 = (usd: number) => `£${(usd * 0.79).toFixed(3)}`;

  const title = [
    `Deepgram (transcription): ${gbp3(cost.deepgram)}`,
    `${transportLabel} (transport): ${gbp3(cost.transport)}`,
    `Claude (cues + scorecard): ${gbp3(cost.claude)}`,
    `Vercel: ${gbp3(cost.vercel)}`,
    `Supabase: ${gbp3(cost.supabase)}`,
    projectedHourly && projectedHourly > 0
      ? `~${gbp(projectedHourly)}/hr projected`
      : "",
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <div
      title={title}
      className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 ${
        overBudget ? "border-rust bg-rust/10" : "border-edge bg-ink/60"
      }`}
    >
      <span className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-muted">
        cost
      </span>
      <span
        className={`font-display text-sm leading-none tabular-nums ${
          overBudget ? "text-rust" : "text-sage"
        }`}
      >
        {gbp(cost.totalGBP)}
      </span>
      {projectedHourly && projectedHourly > 0 ? (
        <span
          className={`font-mono text-[0.55rem] tabular-nums ${
            overBudget ? "text-rust/80" : "text-muted"
          }`}
        >
          ~{gbp(projectedHourly)}/hr
        </span>
      ) : null}
    </div>
  );
}
