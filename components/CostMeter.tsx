"use client";

import type { CostBreakdown } from "@/lib/costs";

// Compact, always-visible live cost meter for the call screen. Shows the
// running session cost and turns rust when the projected hourly pace crosses
// the ceiling. Hover for the per-component breakdown.
export default function CostMeter({
  cost,
  overBudget,
  projectedHourly,
}: {
  cost: CostBreakdown | null;
  overBudget: boolean;
  projectedHourly?: number;
}) {
  if (!cost) return null;

  const gbp = (n: number) => `£${n.toFixed(2)}`;
  const gbp3 = (usd: number) => `£${(usd * 0.79).toFixed(3)}`;

  const title = [
    `Deepgram: ${gbp3(cost.deepgram)}`,
    `Claude: ${gbp3(cost.claude)}`,
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
