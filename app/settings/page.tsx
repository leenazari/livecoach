"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch, getCached } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";

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

  useEffect(() => {
    crmFetch<{ knowledge: string }>("/api/crm/workspace")
      .then((d) => {
        setKnowledge(d.knowledge || "");
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

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

      <NavMenu />
    </main>
  );
}
