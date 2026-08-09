"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import NavMenu from "@/components/crm/NavMenu";
import { crmFetch, getCached } from "@/lib/crm";

type Period = "today" | "week" | "month" | "all";
type AiMode = "economical" | "balanced" | "high";
type PeriodValues = Record<Period, number>;
type Costs = {
  generatedAt: string;
  totals: PeriodValues;
  periods: {
    today: { start: string; end: string };
    week: { start: string; end: string };
    month: { start: string; end: string };
  };
  sources: {
    calls: PeriodValues;
    ai: PeriodValues;
    automation: PeriodValues;
  };
  features: (PeriodValues & {
    feature: string;
    source: "calls" | "ai" | "automation";
  })[];
};

const gbp = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const shortDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const modeCopy: Record<AiMode, string> = {
  economical: "Slow automatic cues, Terra ideas off",
  balanced: "Normal cues, occasional Terra ideas",
  high: "Fast cues, frequent Terra ideas",
};

export default function CostsPage() {
  const [data, setData] = useState<Costs | null>(() => getCached<Costs>("/api/crm/costs") || null);
  const [period, setPeriod] = useState<Period>("today");
  const [aiMode, setAiMode] = useState<AiMode>("balanced");
  const [loading, setLoading] = useState(!data);
  const [modeSaving, setModeSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await crmFetch<Costs>("/api/crm/costs"));
    } catch (reason: any) {
      setError(reason?.message || "Could not load the cost analysis.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    crmFetch<{ mode: AiMode }>("/api/crm/ai-mode")
      .then((result) => setAiMode(result.mode || "balanced"))
      .catch(() => {});
  }, [load]);

  const chooseAiMode = async (mode: AiMode) => {
    if (modeSaving || mode === aiMode) return;
    const previous = aiMode;
    setAiMode(mode);
    setModeSaving(true);
    setError("");
    try {
      const saved = await crmFetch<{ mode: AiMode }>("/api/crm/ai-mode", {
        method: "PUT",
        body: JSON.stringify({ mode }),
      });
      if (saved.mode !== mode) throw new Error("The intelligence mode was not confirmed");
    } catch (reason: any) {
      setAiMode(previous);
      setError(reason?.message || "The intelligence mode did not save.");
    } finally {
      setModeSaving(false);
    }
  };

  const orderedFeatures = useMemo(
    () => [...(data?.features || [])].sort((a, b) => b[period] - a[period]),
    [data, period]
  );
  const total = data?.totals[period] || 0;
  const highest = orderedFeatures[0];
  const periodLabel = period === "today"
    ? "00:00 to now, resets at 00:00 · London time"
    : period === "week"
      ? data ? `${shortDate(data.periods.week.start)} to ${shortDate(data.periods.week.end)}` : ""
      : period === "month"
        ? data ? `${shortDate(data.periods.month.start)} to ${shortDate(data.periods.month.end)}` : ""
        : "Since cost tracking began";

  const sourceCards = data ? [
    ["Live calls", data.sources.calls[period], "Call listening, transcription and live coaching"],
    ["In app AI", data.sources.ai[period], "Preparation, outreach, summaries and Brain"],
    ["Automation", data.sources.automation[period], "Scheduled background CRM work"],
  ] as const : [];

  return (
    <main className="relative z-10 mx-auto max-w-[1100px] px-3 py-5 sm:px-5 sm:py-9">
      <NavMenu />
      <header className="mb-4 flex flex-col gap-3 border-b border-edge pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-sage">
            Model free spend tracking
          </p>
          <h1 className="mt-1 font-display text-[1.65rem] tracking-tight text-bone sm:text-3xl">
            Running <span className="italic text-sage">cost analysis</span>
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Recorded costs across calls, outreach, preparation, Brain and background automation. Opening this page uses no AI tokens.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="min-h-11 w-full rounded-lg border border-sage/50 bg-sage/10 px-4 py-2 font-mono text-[0.61rem] uppercase tracking-wider text-sage disabled:opacity-45 sm:w-auto"
        >
          {loading ? "Refreshing…" : "Refresh costs"}
        </button>
      </header>

      {error ? (
        <p role="alert" className="mb-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm text-rust">
          {error}
        </p>
      ) : null}

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Cost period">
        {(["today", "week", "month", "all"] as Period[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setPeriod(option)}
            aria-pressed={period === option}
            className={`min-h-11 shrink-0 rounded-full border px-4 font-mono text-[0.58rem] uppercase tracking-wider transition ${
              period === option
                ? "border-sage/60 bg-sage/15 text-sage"
                : "border-edge bg-panel text-muted hover:text-bone"
            }`}
          >
            {option === "all" ? "All time" : option}
          </button>
        ))}
      </div>

      {!data ? (
        <section className="rounded-xl border border-edge bg-panel px-4 py-16 text-center">
          <p className="font-mono text-xs uppercase tracking-wider text-muted">Loading recorded costs…</p>
        </section>
      ) : (
        <>
          <section className="mb-4 rounded-xl border border-sage/40 bg-sage/[0.06] p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-mono text-[0.57rem] uppercase tracking-wider text-sage">
                  {period === "all" ? "All recorded spend" : period === "today" ? "Today's spend" : `${period} to date`}
                </p>
                <strong className="mt-1 block font-display text-4xl tabular-nums text-bone">{gbp(total)}</strong>
                <p className="mt-1 text-xs text-muted">{periodLabel}</p>
              </div>
              <div className="rounded-lg border border-edge bg-ink/35 px-3 py-2 sm:max-w-sm">
                <p className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">Biggest cost area</p>
                <p className="mt-1 text-sm text-bone">
                  {highest && highest[period] > 0
                    ? `${highest.feature}: ${gbp(highest[period])}`
                    : "No recorded spend in this period."}
                </p>
              </div>
            </div>
          </section>

          <section className="mb-4 grid gap-2 sm:grid-cols-3">
            {sourceCards.map(([label, value, note]) => (
              <article key={label} className="rounded-xl border border-edge bg-panel p-4">
                <p className="font-mono text-[0.54rem] uppercase tracking-wider text-muted">{label}</p>
                <strong className="mt-1 block font-display text-2xl tabular-nums text-bone">{gbp(value)}</strong>
                <p className="mt-1 text-xs leading-5 text-muted">{note}</p>
              </article>
            ))}
          </section>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-xl border border-edge bg-panel p-4">
              <div className="mb-4">
                <h2 className="font-display text-lg text-bone">Spend by feature</h2>
                <p className="mt-1 text-sm text-muted">Every recorded feature, highest cost first.</p>
              </div>
              {orderedFeatures.length ? (
                <ul className="space-y-3">
                  {orderedFeatures.map((row) => {
                    const value = row[period];
                    return (
                      <li key={`${row.source}:${row.feature}`}>
                        <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                          <span className="text-bone/85">{row.feature}</span>
                          <span className="tabular-nums text-muted">{gbp(value)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-ink/70">
                          <div
                            className="h-full rounded-full bg-sage/70"
                            style={{ width: `${total ? Math.max(value ? 2 : 0, (value / total) * 100) : 0}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted">No costs have been recorded yet.</p>
              )}
            </section>

            <section className="rounded-xl border border-edge bg-panel p-4">
              <h2 className="font-display text-lg text-bone">Live intelligence mode</h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                Control how frequently automatic live suggestions run. Requested Terra work stays available in every mode.
              </p>
              <div className="mt-4 grid gap-2">
                {(["economical", "balanced", "high"] as AiMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => void chooseAiMode(mode)}
                    disabled={modeSaving}
                    className={`min-h-14 rounded-lg border px-3 py-2 text-left transition ${
                      aiMode === mode
                        ? "border-sage/60 bg-sage/10"
                        : "border-edge bg-ink/30 hover:border-sage/40"
                    }`}
                  >
                    <span className={`block font-mono text-[0.56rem] uppercase tracking-wider ${aiMode === mode ? "text-sage" : "text-bone/70"}`}>
                      {aiMode === mode ? "✓ " : ""}{mode === "high" ? "High intelligence" : mode}
                    </span>
                    <span className="mt-1 block text-xs text-muted">{modeCopy[mode]}</span>
                  </button>
                ))}
              </div>
              <p className="mt-3 font-mono text-[0.5rem] leading-relaxed text-muted">
                Changing this saves immediately. It changes suggestion frequency, not the quality of work you request.
              </p>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
