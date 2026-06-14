"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch, getCached } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";

type Lesson = {
  id: string;
  topic: string;
  title: string | null;
  content: string;
  source_url: string | null;
};
const TOPICS = ["negotiation", "psychology", "strategy", "general"];

// Settings = the global "brain". One knowledge base about you and your business
// that gets fed into every AI pass (assistant, build-from-context, post-call
// profiles, the day read, and live-call coaching) so the CRM always reasons
// with your real-world context.
export default function SettingsPage() {
  const cached = getCached<{ knowledge: string }>("/api/crm/workspace");
  const [knowledge, setKnowledge] = useState(cached?.knowledge || "");
  const [loaded, setLoaded] = useState(!!cached);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");

  // Lessons library state.
  const [lessons, setLessons] = useState<Lesson[]>(
    getCached<{ lessons: Lesson[] }>("/api/crm/lessons")?.lessons || []
  );
  const [lTopic, setLTopic] = useState("negotiation");
  const [lSource, setLSource] = useState("");
  const [lContent, setLContent] = useState("");
  const [distilling, setDistilling] = useState(false);
  const [lErr, setLErr] = useState("");

  useEffect(() => {
    crmFetch<{ knowledge: string }>("/api/crm/workspace")
      .then((d) => {
        setKnowledge(d.knowledge || "");
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    crmFetch<{ lessons: Lesson[] }>("/api/crm/lessons")
      .then((d) => setLessons(d.lessons || []))
      .catch(() => {});
  }, []);

  const distil = async () => {
    if (lContent.trim().length < 80) {
      setLErr("Paste a bit more content to learn from.");
      return;
    }
    setDistilling(true);
    setLErr("");
    try {
      const { lesson } = await crmFetch<{ lesson: Lesson }>("/api/crm/lessons", {
        method: "POST",
        body: JSON.stringify({
          content: lContent,
          topic: lTopic,
          sourceUrl: lSource.trim() || null,
        }),
      });
      setLessons((p) => [lesson, ...p]);
      setLContent("");
      setLSource("");
    } catch (e: any) {
      setLErr(e.message || "couldn't distil that");
    } finally {
      setDistilling(false);
    }
  };

  const deleteLesson = (id: string) => {
    setLessons((p) => p.filter((l) => l.id !== id));
    crmFetch(`/api/crm/lessons/${id}`, { method: "DELETE" }).catch(() => {});
  };

  const save = async () => {
    setSaving(true);
    try {
      await crmFetch("/api/crm/workspace", {
        method: "PUT",
        body: JSON.stringify({ knowledge }),
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="relative z-10 mx-auto max-w-[900px] px-5 py-10">
      <header className="mb-5 flex items-center justify-between gap-3 border-b border-edge pb-3">
        <h1 className="font-display text-[1.4rem] leading-none tracking-tight text-bone">
          <span className="italic text-amber">Live</span>Coach{" "}
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted">
            / settings
          </span>
        </h1>
        <Link
          href="/crm"
          className="rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          ◂ dashboard
        </Link>
      </header>

      <div className="rounded-xl border border-amber/40 bg-amber/[0.05] p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-amber">
            {"◆"} Your brain{" "}
            <span className="text-muted">- context the AI uses everywhere</span>
          </p>
          <div className="flex items-center gap-3">
            {savedAt && (
              <span className="font-mono text-[0.56rem] uppercase tracking-wider text-sage">
                saved {savedAt}
              </span>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-full border border-amber/60 bg-amber/15 px-5 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
            >
              {saving ? "saving…" : "save"}
            </button>
          </div>
        </div>
        <p className="mb-3 font-mono text-[0.6rem] leading-relaxed text-muted">
          Who you are, your company, your products, how you sell, your goals.
          This is fed into every AI pass - the assistant, building a client from
          context, post-call profiles, your day read, and live-call coaching -
          so it always knows what you actually do. Keep it in your own words.
        </p>
        <textarea
          value={knowledge}
          onChange={(e) => setKnowledge(e.target.value)}
          rows={20}
          placeholder={
            loaded
              ? "Tell the AI about you and your business…"
              : "loading…"
          }
          className="w-full resize-y rounded-lg border border-edge bg-ink/60 px-4 py-3 font-sans text-sm leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60"
        />
      </div>

      {/* LESSONS LIBRARY - the skills layer (negotiation, psychology, strategy)
          the AI applies. Paste a transcript/article and it distils the durable
          lessons. */}
      <div className="mt-5 rounded-xl border border-sky/40 bg-sky/[0.05] p-5">
        <p className="mb-1 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-sky">
          {"✦"} Lessons library{" "}
          <span className="text-muted">- teach it negotiation, psychology, strategy</span>
        </p>
        <p className="mb-3 font-mono text-[0.6rem] leading-relaxed text-muted">
          Paste a video transcript or article, pick the topic, and it distils
          the durable, reusable lessons. The AI then applies the right ones when
          coaching calls, reading people, and planning your next move. (Tip:
          YouTube → “Show transcript” → copy → paste here.)
        </p>

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <select
            value={lTopic}
            onChange={(e) => setLTopic(e.target.value)}
            className="rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-[0.66rem] uppercase tracking-wider text-bone outline-none focus:border-sky/60"
          >
            {TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            value={lSource}
            onChange={(e) => setLSource(e.target.value)}
            placeholder="Source link (optional)"
            className="min-w-[200px] flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-[0.7rem] text-bone outline-none placeholder:text-muted/50 focus:border-sky/60"
          />
        </div>
        <textarea
          value={lContent}
          onChange={(e) => setLContent(e.target.value)}
          rows={6}
          placeholder="Paste the transcript or article text here…"
          className="w-full resize-y rounded-lg border border-edge bg-ink/60 px-4 py-3 font-sans text-sm leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-sky/60"
        />
        {lErr && (
          <p className="mt-1.5 font-mono text-[0.6rem] text-rust">{lErr}</p>
        )}
        <button
          type="button"
          onClick={distil}
          disabled={distilling}
          className="mt-2 rounded-full border border-sky/60 bg-sky/15 px-5 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-sky transition hover:bg-sky/25 disabled:opacity-40"
        >
          {distilling ? "distilling…" : "distil & save"}
        </button>

        {lessons.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {lessons.map((l) => (
              <li
                key={l.id}
                className="rounded-lg border border-edge bg-ink/40 px-4 py-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-mono text-[0.56rem] uppercase tracking-wider text-sky">
                    {l.topic}
                    {l.title ? ` · ${l.title}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteLesson(l.id)}
                    aria-label="delete lesson"
                    className="font-mono text-[0.7rem] text-muted transition hover:text-rust"
                  >
                    ✕
                  </button>
                </div>
                <p className="whitespace-pre-wrap font-sans text-[0.82rem] leading-relaxed text-bone/85">
                  {l.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NavMenu />
    </main>
  );
}
