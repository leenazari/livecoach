"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { crmFetch } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";

type Call = {
  id: string;
  candidate: string | null;
  role: string | null;
  company: string | null;
  company_id: string | null;
  created_at: string;
  cost: number | string | null;
  ref: string | null;
  summary: any;
  durationSeconds: number | null;
  transcriptChars: number | null;
  participants: string[];
};

type CoachPoint = {
  id: string;
  quote: string;
  better: string;
  why: string;
  vote: number;
};

export default function CallDetailPage() {
  const params = useParams();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id as string);
  const [call, setCall] = useState<Call | null>(null);
  const [error, setError] = useState("");
  // Speaking-coach debrief: generated on demand, votable, learns over time.
  const [coaching, setCoaching] = useState<CoachPoint[]>([]);
  const [coachBusy, setCoachBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    crmFetch<{ call: Call }>(`/api/crm/calls/${id}`)
      .then((d) => setCall(d.call))
      .catch((e) => setError(e?.message || "Could not load this call."));
    // Load any debrief already generated for this call (no model cost).
    crmFetch<{ points: CoachPoint[] }>(
      `/api/interview/coaching-debrief?callId=${id}`
    )
      .then((d) => setCoaching(Array.isArray(d.points) ? d.points : []))
      .catch(() => {});
  }, [id]);

  const generateCoaching = () => {
    if (coachBusy || !id) return;
    setCoachBusy(true);
    crmFetch<{ points: CoachPoint[] }>("/api/interview/coaching-debrief", {
      method: "POST",
      body: JSON.stringify({ callId: id }),
    })
      .then((d) => setCoaching(Array.isArray(d.points) ? d.points : []))
      .catch(() => {})
      .finally(() => setCoachBusy(false));
  };

  const voteCoaching = (pointId: string, vote: number) => {
    setCoaching((prev) =>
      prev.map((p) =>
        p.id === pointId ? { ...p, vote: p.vote === vote ? 0 : vote } : p
      )
    );
    const next =
      coaching.find((p) => p.id === pointId)?.vote === vote ? 0 : vote;
    crmFetch("/api/interview/coaching-vote", {
      method: "POST",
      body: JSON.stringify({ id: pointId, vote: next }),
    }).catch(() => {});
  };

  const gbp = (n: number | string | null) => {
    const v = n == null ? NaN : Number(n);
    return Number.isFinite(v)
      ? `£${v.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "—";
  };
  const fmtDate = (iso?: string) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString(undefined, {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };
  const fmtDuration = (secs: number | null) => {
    if (typeof secs !== "number" || secs <= 0) return null;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };
  // Rough word count from characters (~5.5 chars/word incl. spaces).
  const approxWords = (chars: number | null) =>
    typeof chars === "number" && chars > 0
      ? `~${Math.round(chars / 5.5).toLocaleString()} words`
      : null;

  const s = call?.summary || {};
  const list = (v: any): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];

  const Bullets = ({
    title,
    items,
    tone,
  }: {
    title: string;
    items: string[];
    tone: string;
  }) =>
    items.length ? (
      <section className="mt-4 rounded-xl border border-edge bg-panel/40 p-4">
        <p className={`mb-2 font-mono text-[0.6rem] uppercase tracking-[0.2em] ${tone}`}>
          {title}
        </p>
        <ul className="flex flex-col gap-1.5">
          {items.map((t, i) => (
            <li
              key={i}
              className="flex gap-2 font-sans text-[0.84rem] leading-snug text-bone/85"
            >
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted" />
              {t}
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  return (
    <main className="relative z-10 mx-auto max-w-[820px] px-5 py-10">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
        <h1 className="font-display text-[1.4rem] leading-none tracking-tight text-bone">
          <span className="italic text-amber">Live</span>Coach{" "}
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted">
            / call
          </span>
        </h1>
        <Link
          href="/crm/calls"
          className="rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          ◂ all calls
        </Link>
      </header>

      {error ? (
        <p className="font-mono text-[0.66rem] text-rust">{error}</p>
      ) : !call ? (
        <p className="font-mono text-[0.66rem] text-muted">Loading…</p>
      ) : (
        <>
          {/* Title + meta */}
          <div className="rounded-xl border border-edge bg-panel/40 p-5">
            <p className="font-display text-[1.3rem] leading-tight text-bone">
              {s.title || call.candidate || "Call"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[0.6rem] uppercase tracking-wider text-muted">
              {call.ref && <span className="text-amber/80">{call.ref}</span>}
              <span>{fmtDate(call.created_at)}</span>
              {call.company && (
                <Link
                  href={call.company_id ? `/crm/${call.company_id}` : "/crm/calls"}
                  className="text-sky transition hover:text-amber"
                >
                  · {call.company}
                </Link>
              )}
              {call.candidate && <span>· {call.candidate}</span>}
              <span className="text-sage">· {gbp(call.cost)}</span>
            </div>

            {/* Richer call-event facts from interview_sessions. */}
            {(fmtDuration(call.durationSeconds) ||
              approxWords(call.transcriptChars) ||
              (call.participants && call.participants.length > 0)) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {fmtDuration(call.durationSeconds) && (
                  <span className="rounded-full border border-edge bg-ink/40 px-2.5 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-bone/75">
                    ⏱ {fmtDuration(call.durationSeconds)}
                  </span>
                )}
                {approxWords(call.transcriptChars) && (
                  <span className="rounded-full border border-edge bg-ink/40 px-2.5 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-bone/75">
                    ✎ {approxWords(call.transcriptChars)}
                  </span>
                )}
                {call.participants && call.participants.length > 0 && (
                  <span className="rounded-full border border-edge bg-ink/40 px-2.5 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-bone/75">
                    ◍ {call.participants.join(", ")}
                  </span>
                )}
              </div>
            )}
            {/* Low-capture warning: a real call produces thousands of characters.
                Under ~400 means the mic or transcription almost certainly was
                not picking up, so flag it loudly rather than quietly showing
                nothing. */}
            {call.transcriptChars != null && call.transcriptChars < 400 && (
              <div className="mt-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 font-sans text-[0.82rem] leading-snug text-rust">
                {"⚠"} Low capture. This call only recorded about{" "}
                {Math.max(1, Math.round(call.transcriptChars / 6))} words, so the
                mic or transcription probably was not picking up the
                conversation, and what was said may not have been saved. If you
                have notes from the call, add them to the client so nothing is
                lost.
              </div>
            )}
            {call.transcriptChars == null && (
              <div className="mt-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 font-sans text-[0.82rem] leading-snug text-amber">
                No transcript was saved for this call, only the AI summary below.
              </div>
            )}
            {s.recommendation && (
              <span className="mt-3 inline-block rounded-full border border-amber/40 bg-amber/10 px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider text-amber">
                {s.recommendation}
              </span>
            )}
            {s.headline && (
              <p className="mt-3 font-sans text-[0.95rem] leading-snug text-bone">
                {s.headline}
              </p>
            )}
            {s.overview && (
              <p className="mt-2 font-sans text-[0.86rem] leading-relaxed text-bone/75">
                {s.overview}
              </p>
            )}
          </div>

          {/* Competencies */}
          {Array.isArray(s.competencies) && s.competencies.length > 0 && (
            <section className="mt-4 rounded-xl border border-edge bg-panel/40 p-4">
              <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
                Scorecard
              </p>
              <ul className="flex flex-col gap-2.5">
                {s.competencies.map((c: any, i: number) => {
                  const score = Number(c?.score) || 0;
                  return (
                    <li key={i}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-sans text-[0.84rem] text-bone">
                          {c?.name}
                        </span>
                        <span className="font-mono text-[0.66rem] text-sage">
                          {score}/5
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink">
                        <div
                          className="h-full rounded-full bg-amber/70"
                          style={{ width: `${(score / 5) * 100}%` }}
                        />
                      </div>
                      {c?.note && (
                        <p className="mt-1 font-sans text-[0.76rem] leading-snug text-bone/65">
                          {c.note}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <Bullets title="Strengths" items={list(s.strengths)} tone="text-sage" />
          <Bullets title="Concerns" items={list(s.concerns)} tone="text-rust" />
          <Bullets
            title="◈ Pain points they raised"
            items={list(s.painPoints)}
            tone="text-amber"
          />
          <Bullets
            title="→ Your next actions"
            items={list(s.myNextActions)}
            tone="text-amber"
          />
          <Bullets
            title="Their next actions"
            items={list(s.theirNextActions)}
            tone="text-sky"
          />
          <Bullets
            title="Suggested next moves"
            items={list(s.suggestedNextActions)}
            tone="text-amber"
          />
          <Bullets
            title="Not covered"
            items={list(s.notCovered)}
            tone="text-muted"
          />

          {Array.isArray(s.favouriteCues) && s.favouriteCues.length > 0 && (
            <section className="mt-4 rounded-xl border border-amber/40 bg-amber/[0.06] p-4">
              <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
                {"★"} Cues you kept
              </p>
              <ul className="flex flex-col gap-2">
                {s.favouriteCues
                  .filter((c: any) => c && typeof c.text === "string" && c.text.trim())
                  .map((c: any, i: number) => (
                    <li key={i} className="border-l-2 border-amber/50 pl-3">
                      <p className="font-sans text-[0.86rem] leading-snug text-bone">
                        {c.text}
                      </p>
                      {c.why && typeof c.why === "string" && c.why.trim() && (
                        <p className="font-mono text-[0.56rem] uppercase tracking-wider text-muted">
                          {c.why}
                        </p>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          )}

          {s.styleProfile && (
            <section className="mt-4 rounded-xl border border-edge bg-panel/40 p-4">
              <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-muted">
                Your style
              </p>
              <p className="font-sans text-[0.84rem] leading-relaxed text-bone/80">
                {s.styleProfile}
              </p>
            </section>
          )}

          {/* SPEAKING COACH: a separate debrief on HOW you spoke, line by line,
              with a sharper version of each moment. Vote each one so it learns
              how you like to be coached. Generated on demand. */}
          <section className="mt-4 rounded-xl border border-sky/40 bg-sky/[0.05] p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sky">
                {"🎙"} Speaking coach
              </p>
              {coaching.length > 0 && (
                <span className="font-mono text-[0.54rem] uppercase tracking-wider text-muted">
                  vote each {"↑"}/{"↓"} so it learns
                </span>
              )}
            </div>

            {coaching.length === 0 ? (
              <div className="flex flex-col items-start gap-2">
                <p className="font-sans text-[0.82rem] leading-snug text-bone/75">
                  A line-by-line debrief of how you spoke on this call, with a
                  sharper way to say each moment. Separate from the summary.
                </p>
                <button
                  type="button"
                  onClick={generateCoaching}
                  disabled={coachBusy}
                  className="rounded-full border border-sky/60 bg-sky/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-sky transition hover:bg-sky/25 disabled:opacity-40"
                >
                  {coachBusy ? "coaching…" : "Coach me on this call"}
                </button>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {coaching.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-lg border border-edge bg-ink/40 p-3"
                  >
                    {p.quote && (
                      <p className="font-sans text-[0.8rem] italic leading-snug text-muted">
                        {"“"}
                        {p.quote}
                        {"”"}
                      </p>
                    )}
                    <p className="mt-1.5 font-sans text-[0.86rem] leading-snug text-bone">
                      <span className="font-mono text-[0.54rem] uppercase tracking-wider text-sage">
                        try{" "}
                      </span>
                      {p.better}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      {p.why ? (
                        <span className="font-mono text-[0.56rem] uppercase tracking-wider text-muted">
                          {p.why}
                        </span>
                      ) : (
                        <span />
                      )}
                      <span className="flex flex-none items-center gap-1">
                        <button
                          type="button"
                          onClick={() => voteCoaching(p.id, 1)}
                          title="useful"
                          className={`rounded-full border px-2 py-0.5 font-mono text-[0.7rem] transition ${
                            p.vote === 1
                              ? "border-sage bg-sage/20 text-sage"
                              : "border-edge text-muted hover:text-sage"
                          }`}
                        >
                          {"↑"}
                        </button>
                        <button
                          type="button"
                          onClick={() => voteCoaching(p.id, -1)}
                          title="not useful"
                          className={`rounded-full border px-2 py-0.5 font-mono text-[0.7rem] transition ${
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
          </section>
        </>
      )}

      <NavMenu />
    </main>
  );
}
