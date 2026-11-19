"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";
import ScriptCoachingReport from "@/components/ScriptCoachingReport";
import type { ScriptCoachingReport as Report } from "@/lib/script-coaching-report";
type Call = {
  callId: string;
  sessionId: string;
  ownerId: string;
  ownerName: string;
  title: string;
  createdAt: string;
  state: string;
  report: Report | null;
  ownerNote: string | null;
};
type Data = {
  calls: Call[];
  team: { id: string; name: string }[];
  ownerView: boolean;
  limited: boolean;
  total: number;
  weekly: {
    totalCalls: number;
    analysedCalls: number;
    awaitingCoaching: number;
    repeatedGaps: {
      stage: string;
      occurrences: number;
      acrossSalespeople: number;
      reviewScript: boolean;
    }[];
    priorities: { callId: string; salesperson: string; focus: string }[];
  };
};
export default function CallCoachPage() {
  const [data, setData] = useState<Data | null>(null);
  const [owner, setOwner] = useState("");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    crmFetch<Data>(
      `/api/crm/call-coaching?${new URLSearchParams({ days, ...(owner ? { owner } : {}) })}`,
    )
      .then((v) => {
        if (!cancelled) {
          setData(v);
          setNotes(
            Object.fromEntries(
              v.calls.map((c) => [c.callId, c.ownerNote || ""]),
            ),
          );
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || "Coaching could not load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, days, version]);
  async function generate(call: Call) {
    setBusy(call.callId);
    setError("");
    try {
      const v = await crmFetch<{ ok: boolean; report: Report }>(
        "/api/crm/call-coaching",
        { method: "POST", body: JSON.stringify({ callId: call.callId }) },
      );
      if (!v.ok) throw new Error("The coaching result was not confirmed");
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Coaching not confirmed");
    } finally {
      setBusy("");
    }
  }
  async function correct(call: Call) {
    setBusy(call.callId);
    try {
      const v = await crmFetch<{ ok: boolean }>("/api/crm/call-coaching", {
        method: "PATCH",
        body: JSON.stringify({
          callId: call.callId,
          note: notes[call.callId] || "",
        }),
      });
      if (!v.ok) throw new Error("The correction was not confirmed");
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Correction not confirmed");
    } finally {
      setBusy("");
    }
  }
  function exportReport() {
    if (!data) return;
    const content = [
      `LiveCoach ${days === "all" ? "all calls" : days + "-day"} sales coaching report`,
      `${owner ? data.team.find((t) => t.id === owner)?.name : "Selected calls"}`,
      `${data.weekly.analysedCalls} analysed / ${data.weekly.totalCalls} calls; ${data.weekly.awaitingCoaching} awaiting coaching`,
      ...data.calls.map(
        (c) =>
          `\n${c.ownerName} | ${c.title} | ${new Date(c.createdAt).toLocaleString("en-GB")}\n${c.report ? [c.report.headline, c.report.intentOutcome, `Script coverage: ${c.report.score == null ? "Not scored" : c.report.score + "%"}`, `What worked:\n${c.report.strengths.map((s) => "- " + s).join("\n")}`, `Improve next time:\n${c.report.improvements.map((s) => "- " + s).join("\n")}`, `Next-call priority: ${c.report.nextCallFocus}`, `Product changes: ${c.report.switchReview}`, ...c.report.criteria.map((c) => `${c.stageId}: ${c.status}\n${c.explanation}\n${c.evidenceQuote ? "Evidence: " + c.evidenceQuote : ""}\n${c.betterNextTime}`)].join("\n\n") : "Coaching not requested"}\nOwner review: ${c.ownerNote || "none"}`,
      ),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `LiveCoach_Coaching_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <main className="mx-auto max-w-5xl px-5 py-8 text-bone">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-4">
        <h1 className="text-2xl">Call Coaching</h1>
        <button
          type="button"
          onClick={exportReport}
          disabled={!data || loading}
          className="rounded-full border border-sky px-4 py-2 text-sm text-sky"
        >
          Export coaching report
        </button>
      </header>
      <Link
        href="/crm/call-coach/speaking"
        className="mb-3 inline-block text-sm text-sky underline"
      >
        Earlier speaking coaching and ratings
      </Link>
      <p className="mb-4 text-sm text-muted">
        Get personal feedback when you are ready. Saved reports reopen without
        running another analysis.
      </p>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="text-sm">
          Period{" "}
          <select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="ml-2 rounded-lg border border-edge bg-panel p-2"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="all">All saved calls</option>
          </select>
        </label>
        {data?.ownerView && (
          <label className="text-sm">
            Sales reports{" "}
            <select
              aria-label="Salesperson coaching reports"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="ml-2 rounded-lg border border-edge bg-panel p-2"
            >
              <option value="">All team coaching</option>
              {data.team.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}’s reports
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={() => setVersion((v) => v + 1)}
          className="text-sm text-sky underline"
        >
          Refresh reports
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="my-4 rounded-lg border border-rust/40 p-3 text-rust"
        >
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading saved coaching…</p>
      ) : (
        <>
          {data && (
            <section className="mb-6 rounded-xl border border-edge bg-panel p-4">
              <h2 className="text-lg">
                {owner ? data.team.find((t) => t.id === owner)?.name : "Weekly"}{" "}
                coaching review
              </h2>
              <p className="mt-2 text-sm text-muted">
                {data.weekly.analysedCalls} analysed ·{" "}
                {data.weekly.awaitingCoaching} awaiting coaching ·{" "}
                {data.weekly.totalCalls} calls in this view
              </p>
              {data.limited && (
                <p className="mt-2 text-amber">
                  Showing the latest 1,000 of {data.total} records. Select a
                  salesperson to narrow the review.
                </p>
              )}
              {data.weekly.repeatedGaps.map((g) => (
                <p key={g.stage} className="mt-3 text-sm">
                  {g.stage.replaceAll("_", " ")}: {g.occurrences} areas to
                  improve.
                  {g.reviewScript
                    ? " Both salespeople are encountering this gap: review the script as well as individual execution."
                    : ""}
                </p>
              ))}
              {data.weekly.priorities.slice(0, 5).map((p) => (
                <p key={p.callId} className="mt-2 text-sm text-sage">
                  {p.salesperson}: {p.focus}
                </p>
              ))}
            </section>
          )}
          {data?.calls.length === 0 && <p>No calls in this period.</p>}
          <div className="space-y-4">
            {data?.calls.map((call) => (
              <article
                key={call.callId}
                className="rounded-xl border border-edge bg-panel p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted">
                      {call.ownerName} ·{" "}
                      {new Date(call.createdAt).toLocaleString("en-GB")}
                    </p>
                    <h2 className="mt-1 text-lg">{call.title}</h2>
                    <a
                      className="text-xs text-sky underline"
                      href={`/api/crm/call-coaching?transcript=1&callId=${call.callId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open transcript
                    </a>
                  </div>
                  {!call.report && (
                    <button
                      type="button"
                      disabled={!!busy || call.state === "generating"}
                      onClick={() => generate(call)}
                      className="min-h-11 rounded-full bg-sky px-5 py-2 text-sm font-medium text-ink disabled:opacity-50"
                    >
                      {busy === call.callId || call.state === "generating"
                        ? "Analysing…"
                        : "Get coaching"}
                    </button>
                  )}
                </div>
                {call.report && (
                  <ScriptCoachingReport
                    report={call.report}
                    sessionId={call.sessionId}
                    callId={call.callId}
                    ownerNote={call.ownerNote}
                  />
                )}{" "}
                {data.ownerView && call.report && (
                  <div className="mt-4 border-t border-edge pt-3">
                    <label className="block text-sm">
                      Owner review or correction
                      <textarea
                        value={notes[call.callId] || ""}
                        maxLength={4000}
                        onChange={(e) =>
                          setNotes((n) => ({
                            ...n,
                            [call.callId]: e.target.value,
                          }))
                        }
                        rows={2}
                        className="mt-2 w-full rounded-lg border border-edge bg-ink p-2"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => correct(call)}
                      className="mt-2 text-sm text-sky underline"
                    >
                      Save owner review
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      <NavMenu />
    </main>
  );
}
