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

const safeList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()) : [];

export default function PitchPlaybookPage() {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    crmFetch<{ chapters: Chapter[] }>("/api/crm/pitch-playbook")
      .then((data) => setChapters(Array.isArray(data.chapters) ? data.chapters : []))
      .catch((err) => setError(err?.message || "Could not load the playbook"))
      .finally(() => setLoading(false));
  }, []);

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
