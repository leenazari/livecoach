"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";

type Point = {
  id: string;
  quote: string;
  better: string;
  why: string;
  vote: number;
};
type CallCoach = {
  callId: string;
  candidate: string | null;
  company: string | null;
  created_at: string;
  title: string;
  status: "todo" | "review" | "done";
  points: Point[];
};

const fmt = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

export default function CallCoachPage() {
  const [calls, setCalls] = useState<CallCoach[]>([]);
  const [counts, setCounts] = useState({ todo: 0, review: 0, done: 0 });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string>("");
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    crmFetch<{ calls: CallCoach[]; counts: any }>("/api/interview/coaching-queue")
      .then((d) => {
        setCalls(Array.isArray(d.calls) ? d.calls : []);
        if (d.counts) setCounts(d.counts);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const recompute = (cs: CallCoach[]) =>
    setCounts({
      todo: cs.filter((c) => c.status === "todo").length,
      review: cs.filter((c) => c.status === "review").length,
      done: cs.filter((c) => c.status === "done").length,
    });

  const statusOf = (points: Point[]): CallCoach["status"] =>
    points.length === 0
      ? "todo"
      : points.some((p) => !p.vote)
      ? "review"
      : "done";

  const generate = (callId: string) => {
    if (busy) return;
    setBusy(callId);
    crmFetch<{ points: Point[] }>("/api/interview/coaching-debrief", {
      method: "POST",
      body: JSON.stringify({ callId }),
    })
      .then((d) => {
        const points = Array.isArray(d.points) ? d.points : [];
        setCalls((prev) => {
          const next = prev.map((c) =>
            c.callId === callId ? { ...c, points, status: statusOf(points) } : c
          );
          recompute(next);
          return next;
        });
      })
      .catch(() => {})
      .finally(() => setBusy(""));
  };

  const vote = (callId: string, pointId: string, v: number) => {
    setCalls((prev) => {
      const next = prev.map((c) => {
        if (c.callId !== callId) return c;
        const points = c.points.map((p) =>
          p.id === pointId ? { ...p, vote: p.vote === v ? 0 : v } : p
        );
        return { ...c, points, status: statusOf(points) };
      });
      recompute(next);
      return next;
    });
    const cur = calls
      .find((c) => c.callId === callId)
      ?.points.find((p) => p.id === pointId)?.vote;
    const nextVote = cur === v ? 0 : v;
    crmFetch("/api/interview/coaching-vote", {
      method: "POST",
      body: JSON.stringify({ id: pointId, vote: nextVote }),
    }).catch(() => {});
  };

  const visible = calls.filter((c) => showDone || c.status !== "done");
  const badge = (st: CallCoach["status"]) =>
    st === "todo"
      ? { label: "to do", cls: "border-amber/60 bg-amber/15 text-amber" }
      : st === "review"
      ? { label: "review", cls: "border-sky/60 bg-sky/15 text-sky" }
      : { label: "done", cls: "border-sage/50 bg-sage/10 text-sage" };

  return (
    <main className="relative z-10 mx-auto max-w-[820px] px-5 py-10">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
        <h1 className="font-display text-[1.4rem] leading-none tracking-tight text-bone">
          <span className="italic text-amber">Live</span>Coach{" "}
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted">
            / call coach
          </span>
        </h1>
        <div className="flex items-center gap-2 font-mono text-[0.56rem] uppercase tracking-wider">
          <span className="rounded-full border border-amber/50 bg-amber/10 px-2 py-0.5 text-amber">
            {counts.todo} to do
          </span>
          <span className="rounded-full border border-sky/40 bg-sky/10 px-2 py-0.5 text-sky">
            {counts.review} in review
          </span>
        </div>
      </header>

      <p className="mb-4 font-sans text-[0.84rem] leading-snug text-bone/70">
        Your speaking training across every call, in one place. Generate a
        debrief, then thumb each tip up or down so the coach learns how you like
        to be coached.
      </p>

      {!loaded ? (
        <p className="font-mono text-[0.66rem] text-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="font-mono text-[0.66rem] text-muted">
          {calls.length === 0
            ? "No coachable calls yet. Once a call has a transcript it shows here."
            : "All caught up. Nice."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((c) => {
            const b = badge(c.status);
            return (
              <li
                key={c.callId}
                className="rounded-xl border border-edge bg-panel/40 p-4"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/crm/calls/${c.callId}`}
                      className="block truncate font-sans text-[0.95rem] text-bone hover:text-amber"
                    >
                      {c.title}
                    </Link>
                    <span className="font-mono text-[0.54rem] uppercase tracking-wider text-muted">
                      {c.company ? `${c.company} · ` : ""}
                      {fmt(c.created_at)}
                    </span>
                  </div>
                  <span
                    className={`flex-none rounded-full border px-2 py-0.5 font-mono text-[0.52rem] uppercase tracking-wider ${b.cls}`}
                  >
                    {b.label}
                  </span>
                </div>

                {c.points.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => generate(c.callId)}
                    disabled={!!busy}
                    className="rounded-full border border-sky/60 bg-sky/15 px-4 py-1.5 font-mono text-[0.56rem] uppercase tracking-wider text-sky transition hover:bg-sky/25 disabled:opacity-40"
                  >
                    {busy === c.callId ? "coaching…" : "Generate coaching"}
                  </button>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {c.points.map((p) => (
                      <li
                        key={p.id}
                        className="rounded-lg border border-edge bg-ink/40 p-3"
                      >
                        {p.quote && (
                          <p className="font-sans text-[0.78rem] italic leading-snug text-muted">
                            {"“"}
                            {p.quote}
                            {"”"}
                          </p>
                        )}
                        <p className="mt-1.5 font-sans text-[0.85rem] leading-snug text-bone">
                          <span className="font-mono text-[0.52rem] uppercase tracking-wider text-sage">
                            try{" "}
                          </span>
                          {p.better}
                        </p>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          {p.why ? (
                            <span className="font-mono text-[0.54rem] uppercase tracking-wider text-muted">
                              {p.why}
                            </span>
                          ) : (
                            <span />
                          )}
                          <span className="flex flex-none items-center gap-1">
                            <button
                              type="button"
                              onClick={() => vote(c.callId, p.id, 1)}
                              title="useful"
                              className={`rounded-full border px-2 py-0.5 font-mono text-[0.68rem] transition ${
                                p.vote === 1
                                  ? "border-sage bg-sage/20 text-sage"
                                  : "border-edge text-muted hover:text-sage"
                              }`}
                            >
                              {"↑"}
                            </button>
                            <button
                              type="button"
                              onClick={() => vote(c.callId, p.id, -1)}
                              title="not useful"
                              className={`rounded-full border px-2 py-0.5 font-mono text-[0.68rem] transition ${
                                p.vote === -1
                                  ? "border-rust bg-rust/20 text-rust"
                                  : "border-edge text-muted hover:text-rust"
                              }`}
                            >
                              {"↓"}
                            </button>
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {counts.done > 0 && (
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          className="mt-4 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:text-bone"
        >
          {showDone ? "hide" : "show"} {counts.done} done
        </button>
      )}

      <NavMenu />
    </main>
  );
}
