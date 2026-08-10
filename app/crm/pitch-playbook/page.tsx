"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import NavMenu from "@/components/crm/NavMenu";
import { crmFetch } from "@/lib/crm";

type Chapter = {
  id: string;
  title: string;
  createdAt: string;
  mode?: "prospect_demo" | "commercial_partner";
  callId?: string;
  callDate?: string;
  company?: string | null;
  candidate?: string | null;
  scenario?: string;
  audience?: string;
  buyerLanguage?: string[];
  questionsThatWorked?: string[];
  pitchMoves?: string[];
  objections?: { signal: string; response: string }[];
  buyingSignals?: string[];
  avoid?: string[];
  script?: string[];
};

type ReviewCandidate = {
  id: string;
  candidate: string | null;
  role: string | null;
  company: string | null;
  companyId: string | null;
  createdAt: string;
  callType: string;
  score: number;
  reasons: string[];
  suggestedMode: "prospect_demo" | "commercial_partner";
  durationSeconds: number | null;
  evidenceCount: number;
  transcriptChars: number;
};

const safeList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()) : [];

export default function PitchPlaybookPage() {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [reviewQueue, setReviewQueue] = useState<ReviewCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modes, setModes] = useState<Record<string, "prospect_demo" | "commercial_partner">>({});
  const [queuePage, setQueuePage] = useState(0);
  const [building, setBuilding] = useState(false);
  const [buildNote, setBuildNote] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    return crmFetch<{ chapters: Chapter[]; reviewQueue: ReviewCandidate[] }>("/api/crm/pitch-playbook")
      .then((data) => {
        const nextChapters = Array.isArray(data.chapters) ? data.chapters : [];
        const nextQueue = Array.isArray(data.reviewQueue) ? data.reviewQueue : [];
        setChapters(nextChapters);
        setReviewQueue(nextQueue);
        setModes(Object.fromEntries(nextQueue.map((call) => [call.id, call.suggestedMode])));
        setQueuePage(0);
      })
      .catch((err) => setError(err?.message || "Could not load the playbook"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleQueue = reviewQueue.slice(queuePage * 5, queuePage * 5 + 5);
  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  };

  const buildSelected = async () => {
    if (!selected.size || building) return;
    const calls = reviewQueue.filter((call) => selected.has(call.id)).slice(0, 5);
    setBuilding(true);
    setBuildNote(`Building 1 of ${calls.length}…`);
    let built = 0;
    const failures: string[] = [];
    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      setBuildNote(`Building ${index + 1} of ${calls.length}: ${call.company || call.candidate || "call"}…`);
      try {
        await crmFetch("/api/crm/pitch-playbook", {
          method: "POST",
          body: JSON.stringify({ callId: call.id, mode: modes[call.id] || call.suggestedMode }),
        });
        built += 1;
      } catch (error: any) {
        failures.push(`${call.company || call.candidate || "Call"}: ${error?.message || "failed"}`);
      }
    }
    setSelected(new Set());
    await load();
    setBuildNote(
      failures.length
        ? `${built} ${built === 1 ? "lesson" : "lessons"} built. ${failures.join(" ")}`
        : `${built} ${built === 1 ? "lesson" : "lessons"} added to the playbook.`
    );
    setBuilding(false);
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds || seconds <= 0) return "Duration unavailable";
    return `${Math.max(1, Math.round(seconds / 60))} minutes`;
  };

  const List = ({ title, items, tone = "text-bone/80" }: { title: string; items: string[]; tone?: string }) =>
    items.length ? (
      <div>
        <p className="mb-1.5 font-mono text-[0.56rem] uppercase tracking-[0.17em] text-muted">{title}</p>
        <ul className={`space-y-1.5 text-[0.82rem] leading-snug ${tone}`}>
          {items.map((item, index) => <li key={index}>• {item}</li>)}
        </ul>
      </div>
    ) : null;

  return (
    <main className="relative z-10 mx-auto max-w-[1040px] px-4 py-8 sm:px-6">
      <NavMenu />
      <header className="mb-6 flex flex-col gap-3 border-b border-edge pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-sage">Sales training</p>
          <h1 className="mt-1 font-display text-3xl text-bone">Interviewa pitching playbook</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            A living training document built only from prospect, demo and explicitly approved commercial partner calls.
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Link href="/crm/calls" className="rounded-full border border-edge px-4 py-2 font-mono text-[0.6rem] uppercase text-muted hover:border-amber/50 hover:text-amber">
            Choose a call
          </Link>
          <button type="button" onClick={() => window.print()} className="rounded-full border border-sage/50 bg-sage/10 px-4 py-2 font-mono text-[0.6rem] uppercase text-sage hover:bg-sage/20">
            Print or save PDF
          </button>
        </div>
      </header>

      {loading ? <p className="font-mono text-sm text-muted">Loading the playbook…</p> : null}
      {error ? <p className="rounded-xl border border-rust/40 bg-rust/10 p-4 text-sm text-rust">{error}</p> : null}
      {!loading && !error && reviewQueue.length > 0 ? (
        <section className="mb-6 rounded-2xl border border-amber/40 bg-amber/[0.04] p-4 sm:p-5 print:hidden">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-amber">Pitch playbook review queue</p>
              <h2 className="mt-1 font-display text-xl text-bone">Choose the calls worth teaching from</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
                This shortlist uses saved CRM facts and transcript size, so reviewing it costs no AI tokens. Internal, interview, support and weak calls are excluded.
              </p>
            </div>
            <div className="shrink-0 rounded-lg border border-edge bg-ink/35 px-3 py-2 text-right">
              <p className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">Eligible calls</p>
              <p className="font-display text-xl text-amber">{reviewQueue.length}</p>
            </div>
          </div>

          <div className="mt-4 space-y-2.5">
            {visibleQueue.map((call) => {
              const checked = selected.has(call.id);
              const confidence = call.score >= 75 ? "strong" : call.score >= 58 ? "good" : "possible";
              return (
                <div key={call.id} className={`rounded-xl border p-3.5 transition ${checked ? "border-amber bg-amber/[0.07]" : "border-edge bg-panel/45"}`}>
                  <div className="flex items-start gap-3">
                    <button type="button" onClick={() => toggleSelected(call.id)} aria-pressed={checked} className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border font-mono text-sm ${checked ? "border-amber bg-amber text-ink" : "border-edge text-muted hover:border-amber/60 hover:text-amber"}`}>
                      {checked ? "✓" : ""}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-display text-[1.05rem] text-bone">{call.company || call.candidate || "Unnamed call"}</p>
                          <p className="text-[0.76rem] text-muted">
                            {[call.candidate && call.candidate !== call.company ? call.candidate : "", call.role].filter(Boolean).join(" · ") || "Recorded sales conversation"}
                          </p>
                        </div>
                        <span className={`w-fit rounded-full border px-2.5 py-1 font-mono text-[0.52rem] uppercase ${call.score >= 75 ? "border-sage/50 bg-sage/10 text-sage" : "border-amber/50 bg-amber/10 text-amber"}`}>
                          {call.score}/100 · {confidence}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {call.reasons.map((reason) => <span key={reason} className="rounded-full border border-edge bg-ink/40 px-2 py-1 text-[0.66rem] text-bone/70">{reason}</span>)}
                      </div>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="font-mono text-[0.55rem] uppercase tracking-wider text-muted">
                          {new Date(call.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · {formatDuration(call.durationSeconds)} · ~{Math.round(call.transcriptChars / 5.5).toLocaleString()} words
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <select aria-label="Playbook lesson type" value={modes[call.id] || call.suggestedMode} onChange={(event) => setModes((current) => ({ ...current, [call.id]: event.target.value as "prospect_demo" | "commercial_partner" }))} className="min-h-10 rounded-lg border border-edge bg-ink/60 px-3 font-mono text-[0.56rem] uppercase text-bone outline-none focus:border-amber/60">
                            <option value="prospect_demo">Prospect or demo</option>
                            <option value="commercial_partner">Commercial partner</option>
                          </select>
                          <Link href={`/crm/calls/${call.id}`} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-edge px-3 font-mono text-[0.56rem] uppercase text-sky hover:border-sky/50">Review call</Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-edge/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[0.76rem] leading-snug text-muted">Selecting is free. Building uses one Terra extraction per approved call and never contacts the client.</p>
              {buildNote ? <p className="mt-1 text-[0.76rem] text-amber">{buildNote}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => { setQueuePage((page) => Math.max(0, page - 1)); setSelected(new Set()); }} disabled={queuePage === 0 || building} className="min-h-10 rounded-full border border-edge px-3 font-mono text-[0.56rem] uppercase text-muted disabled:opacity-30">Previous five</button>
              <button type="button" onClick={() => { setQueuePage((page) => page + 1); setSelected(new Set()); }} disabled={(queuePage + 1) * 5 >= reviewQueue.length || building} className="min-h-10 rounded-full border border-edge px-3 font-mono text-[0.56rem] uppercase text-muted disabled:opacity-30">Next five</button>
              <button type="button" onClick={buildSelected} disabled={!selected.size || building} className="min-h-10 rounded-full border border-amber/60 bg-amber/15 px-4 font-mono text-[0.58rem] uppercase text-amber hover:bg-amber/25 disabled:opacity-35">
                {building ? "Building lessons…" : `Build ${selected.size || "selected"} ${selected.size === 1 ? "lesson" : "lessons"}`}
              </button>
            </div>
          </div>
        </section>
      ) : null}
      {!loading && !error && chapters.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-edge bg-panel/30 p-6">
          <h2 className="font-display text-xl text-bone">No approved calls yet</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Open a useful prospect or demo call, then choose Add to pitching playbook. Internal and routine partner calls remain excluded.
          </p>
          <Link href="/crm/calls" className="mt-4 inline-flex rounded-full border border-amber/50 bg-amber/10 px-4 py-2 font-mono text-[0.6rem] uppercase text-amber">
            Open calls
          </Link>
        </section>
      ) : null}

      <div className="space-y-5">
        {chapters.map((chapter, chapterIndex) => (
          <article key={chapter.id} className="break-inside-avoid rounded-2xl border border-edge bg-panel/45 p-4 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-sage">
                  Lesson {chapters.length - chapterIndex} · {chapter.mode === "commercial_partner" ? "commercial partner" : "prospect or demo"}
                </p>
                <h2 className="mt-1 font-display text-xl text-bone">{chapter.title}</h2>
                {chapter.audience ? <p className="mt-1 text-sm text-muted">Useful with: {chapter.audience}</p> : null}
              </div>
              {chapter.callId ? (
                <Link href={`/crm/calls/${chapter.callId}`} className="shrink-0 font-mono text-[0.58rem] uppercase text-sky hover:text-amber print:hidden">
                  Source call ↗
                </Link>
              ) : null}
            </div>

            {chapter.scenario ? (
              <div className="mt-4 rounded-xl border border-sage/30 bg-sage/[0.06] p-3 text-sm leading-6 text-bone/85">
                <span className="font-mono text-[0.56rem] uppercase tracking-[0.16em] text-sage">When to use this</span>
                <p className="mt-1">{chapter.scenario}</p>
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <List title="Buyer language" items={safeList(chapter.buyerLanguage)} tone="text-sky/90" />
              <List title="Questions that worked" items={safeList(chapter.questionsThatWorked)} />
              <List title="Pitch moves" items={safeList(chapter.pitchMoves)} tone="text-sage/90" />
              <List title="Buying signals" items={safeList(chapter.buyingSignals)} tone="text-amber/90" />
            </div>

            {Array.isArray(chapter.objections) && chapter.objections.length ? (
              <div className="mt-4">
                <p className="mb-2 font-mono text-[0.56rem] uppercase tracking-[0.17em] text-muted">Objections and response</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {chapter.objections.map((item, index) => (
                    <div key={index} className="rounded-lg border border-edge bg-ink/35 p-3 text-[0.8rem] leading-snug">
                      <p className="text-rust">{item.signal}</p>
                      <p className="mt-1 text-bone/80">Then: {item.response}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 rounded-xl border border-amber/35 bg-amber/[0.05] p-4">
              <p className="font-mono text-[0.56rem] uppercase tracking-[0.17em] text-amber">Reusable conversation path</p>
              <ol className="mt-2 space-y-2">
                {safeList(chapter.script).map((line, index) => (
                  <li key={index} className="flex gap-3 text-sm leading-6 text-bone/85">
                    <span className="font-mono text-amber/70">{index + 1}</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="mt-4"><List title="Avoid next time" items={safeList(chapter.avoid)} tone="text-rust/85" /></div>
          </article>
        ))}
      </div>
    </main>
  );
}
