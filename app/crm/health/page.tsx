"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NavMenu from "@/components/crm/NavMenu";
import { crmFetch } from "@/lib/crm";
import type {
  HealthAction,
  HealthCheck,
  HealthReport,
  HealthStatus,
} from "@/lib/crm-health";

type Filter = "needs-attention" | "all" | "healthy";

const statusCopy: Record<
  HealthStatus,
  { label: string; dot: string; border: string; panel: string; text: string }
> = {
  healthy: {
    label: "Healthy",
    dot: "bg-moss",
    border: "border-moss/35",
    panel: "bg-moss/[0.07]",
    text: "text-moss",
  },
  attention: {
    label: "Needs attention",
    dot: "bg-amber",
    border: "border-amber/40",
    panel: "bg-amber/[0.08]",
    text: "text-amber",
  },
  critical: {
    label: "Critical",
    dot: "bg-rust",
    border: "border-rust/50",
    panel: "bg-rust/[0.08]",
    text: "text-rust",
  },
};

const button =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-amber/55 bg-amber/10 px-4 py-2 text-center font-mono text-[0.61rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:cursor-wait disabled:opacity-45";

const formatCheckedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

export default function CrmHealthPage() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [filter, setFilter] = useState<Filter>("needs-attention");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await crmFetch<HealthReport>("/api/crm/health");
      setReport(next);
    } catch (reason: any) {
      setError(reason?.message || "The CRM health check could not run.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (check: HealthCheck, action: HealthAction) => {
    if (action.confirm && !window.confirm(action.confirm)) return;
    setBusy(check.id);
    setNotice("");
    setError("");
    try {
      const result = await crmFetch<Record<string, any>>(action.endpoint, {
        method: action.method,
      });
      const changed = result.folded !== undefined
        ? Number(result.folded) || 0
        : [result.added, result.updated, result.removed, result.relinked, result.outreachLinked]
            .reduce((total, value) => total + (Number(value) || 0), 0);
      setNotice(
        changed > 0
          ? `${action.label} completed: ${changed} record${changed === 1 ? "" : "s"} updated.`
          : `${action.label} completed. Everything was already current.`
      );
      await load();
    } catch (reason: any) {
      setError(reason?.message || `${action.label} could not complete.`);
    } finally {
      setBusy("");
    }
  };

  const visible = useMemo(() => {
    if (!report) return [];
    if (filter === "healthy") {
      return report.checks.filter((check) => check.status === "healthy");
    }
    if (filter === "needs-attention") {
      return report.checks.filter((check) => check.status !== "healthy");
    }
    return report.checks;
  }, [filter, report]);

  const overallStyle = report ? statusCopy[report.overall] : statusCopy.healthy;

  return (
    <main className="relative z-10 mx-auto max-w-[1180px] px-3 py-5 sm:px-5 sm:py-9">
      <NavMenu />
      <header className="mb-4 flex flex-col gap-3 border-b border-edge pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-amber">
            Model-free control centre
          </p>
          <h1 className="mt-1 font-display text-[1.65rem] tracking-tight text-bone sm:text-3xl">
            CRM <span className="italic text-amber">health check</span>
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            One live sweep for data integrity, follow-up gaps, Google access and unusual AI spend. The scan reads concise facts only and uses no AI tokens.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || !!busy} className={`${button} w-full sm:w-auto`}>
          {loading ? "Checking…" : "Refresh health check"}
        </button>
      </header>

      <div aria-live="polite">
        {notice ? (
          <p className="mb-3 rounded-lg border border-moss/40 bg-moss/10 px-3 py-2 text-sm text-moss">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mb-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm text-rust">
            {error}
          </p>
        ) : null}
      </div>

      {loading && !report ? (
        <section className="rounded-xl border border-edge bg-panel px-4 py-16 text-center">
          <p className="font-mono text-xs uppercase tracking-wider text-muted">Reading the live CRM…</p>
          <p className="mt-2 text-sm text-muted">No transcript, email body or AI model is being loaded.</p>
        </section>
      ) : null}

      {report ? (
        <>
          <section className={`mb-4 rounded-xl border p-4 sm:p-5 ${overallStyle.border} ${overallStyle.panel}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 h-4 w-4 shrink-0 rounded-full shadow-[0_0_18px_currentColor] ${overallStyle.dot}`} aria-hidden="true" />
                <div>
                  <p className={`font-mono text-[0.62rem] uppercase tracking-wider ${overallStyle.text}`}>
                    Overall · {statusCopy[report.overall].label}
                  </p>
                  <h2 className="mt-1 font-display text-xl text-bone">
                    {report.overall === "healthy"
                      ? "The CRM is tidy and ready to work."
                      : report.overall === "critical"
                        ? "Fix the red items before relying on every workflow."
                        : "The core system is working, with a few items to tidy."}
                  </h2>
                  <p className="mt-1 text-xs text-muted">Checked {formatCheckedAt(report.generatedAt)} · London time</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:min-w-[310px]">
                {(["critical", "attention", "healthy"] as HealthStatus[]).map((status) => (
                  <button
                    type="button"
                    key={status}
                    onClick={() => setFilter(status === "healthy" ? "healthy" : "needs-attention")}
                    className={`min-h-16 rounded-lg border px-2 py-2 text-center ${statusCopy[status].border} ${statusCopy[status].panel}`}
                  >
                    <strong className={`block font-display text-2xl ${statusCopy[status].text}`}>{report.totals[status]}</strong>
                    <span className="font-mono text-[0.48rem] uppercase tracking-wider text-muted">{statusCopy[status].label}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter health checks">
            {[
              ["needs-attention", `Needs attention (${report.totals.critical + report.totals.attention})`],
              ["all", `All checks (${report.checks.length})`],
              ["healthy", `Healthy (${report.totals.healthy})`],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                onClick={() => setFilter(value as Filter)}
                aria-pressed={filter === value}
                className={`min-h-11 shrink-0 rounded-full border px-4 font-mono text-[0.58rem] uppercase tracking-wider transition ${
                  filter === value
                    ? "border-amber/60 bg-amber/15 text-amber"
                    : "border-edge bg-panel text-muted hover:text-bone"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {visible.length ? (
            <section className="grid gap-3 lg:grid-cols-2" aria-label="CRM health results">
              {visible.map((check) => {
                const style = statusCopy[check.status];
                return (
                  <article id={check.id} key={check.id} className={`scroll-mt-4 rounded-xl border bg-panel p-4 ${style.border}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
                        <div className="min-w-0">
                          <p className={`font-mono text-[0.55rem] uppercase tracking-wider ${style.text}`}>{style.label}</p>
                          <h3 className="mt-0.5 font-display text-lg text-bone">{check.title}</h3>
                        </div>
                      </div>
                      {check.count > 0 ? (
                        <span className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-xs ${style.border} ${style.panel} ${style.text}`}>
                          {check.count}
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-3 text-sm leading-6 text-bone/90">{check.detail}</p>
                    <p className="mt-2 text-xs leading-5 text-muted"><span className="text-bone/75">Why it matters:</span> {check.why}</p>

                    {check.examples?.length ? (
                      <ul className="mt-3 space-y-1 rounded-lg border border-edge bg-ink/35 px-3 py-2 text-xs leading-5 text-muted">
                        {check.examples.map((example, index) => (
                          <li key={`${check.id}:${index}`} className="break-words">• {example}</li>
                        ))}
                      </ul>
                    ) : null}

                    {check.href || check.action ? (
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                        {check.action ? (
                          <button
                            type="button"
                            onClick={() => void runAction(check, check.action as HealthAction)}
                            disabled={!!busy || loading}
                            className={`${button} w-full sm:w-auto`}
                          >
                            {busy === check.id ? "Working…" : check.action.label}
                          </button>
                        ) : null}
                        {check.href ? (
                          <Link href={check.href} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-edge px-4 py-2 font-mono text-[0.61rem] uppercase tracking-wider text-muted transition hover:border-bone/30 hover:text-bone sm:w-auto">
                            Open and review
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </section>
          ) : (
            <section className="rounded-xl border border-moss/35 bg-moss/[0.07] px-4 py-12 text-center">
              <p className="font-display text-xl text-bone">Nothing needs attention.</p>
              <p className="mt-1 text-sm text-muted">Switch to All checks to see the healthy controls.</p>
            </section>
          )}

          <aside className="mt-4 rounded-xl border border-edge bg-ink/30 p-4 text-xs leading-5 text-muted">
            <strong className="text-bone">Cost guardrail:</strong> refreshing this page uses database and Google status checks only. It does not send CRM content to an AI model. Calendar refresh may use one small low-cost classification only for a brand-new ambiguous event title.
          </aside>
        </>
      ) : null}
    </main>
  );
}
