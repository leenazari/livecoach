"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { crmFetch } from "@/lib/crm";
import CompanyLinkPicker from "@/components/crm/CompanyLinkPicker";
import VoiceNoteButton from "@/components/VoiceNoteButton";
import NavMenu from "@/components/crm/NavMenu";

// LOG A CALL THAT ALREADY HAPPENED. For a call you had but did not run through
// LiveCoach live. No prep, no focus, no battle plan, no fake live call - just
// pick the client, say what happened (voice or type), and save. It builds the
// scorecard from your recap, lands it in the client's call history, folds it
// into their profile and to-dos, and so shapes the next call's intent.
function LogCallInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const companyId = sp.get("company") || "";
  const companyName = sp.get("companyName") || "";

  const [company, setCompany] = useState<{ id: string; name: string } | null>(
    companyId ? { id: companyId, name: companyName || "client" } : null
  );
  const [who, setWho] = useState("");
  const [recap, setRecap] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const canSave = !!company && recap.trim().length >= 20 && !saving;

  const save = async () => {
    if (!company || recap.trim().length < 20) {
      setErr("Pick the client and add a few lines on what happened.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const sessionId = `lc-recap-${Math.random().toString(36).slice(2, 9)}`;
      const { summary } = await crmFetch<{ summary: any }>(
        "/api/interview/summary",
        {
          method: "POST",
          body: JSON.stringify({
            transcript: recap.trim(),
            candidate: who.trim() || null,
            competencies: [],
            callType: "general",
            sessionId,
            companyId: company.id,
            source: "recap",
          }),
        }
      );
      // Fold the recap into the client's running profile + next-step tasks, and
      // pull out any commitments, so it shapes the next call. Best-effort.
      crmFetch("/api/crm/update-profile", {
        method: "POST",
        body: JSON.stringify({
          companyId: company.id,
          summary,
          sessionId,
          candidate: who.trim() || null,
        }),
      }).catch(() => {});
      crmFetch("/api/crm/commitments/detect", {
        method: "POST",
        body: JSON.stringify({
          companyId: company.id,
          text: recap.trim(),
          clientName: who.trim() || null,
          source: "recap",
        }),
      }).catch(() => {});
      if (typeof window !== "undefined")
        window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      router.push(`/crm/${company.id}`);
    } catch (e: any) {
      setErr(e?.message || "could not save the call, try again");
      setSaving(false);
    }
  };

  return (
    <main className="relative z-10 mx-auto max-w-[720px] px-5 py-10">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
        <h1 className="font-display text-[1.4rem] leading-none tracking-tight text-bone">
          <span className="italic text-amber">Log</span> a call{" "}
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted">
            / already happened
          </span>
        </h1>
        <Link
          href={company ? `/crm/${company.id}` : "/crm"}
          className="rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          ◂ back
        </Link>
      </header>

      <p className="mb-4 font-mono text-[0.62rem] leading-relaxed text-muted">
        For a call you had but did not run live through LiveCoach. No prep, no
        focus, no plan. Say what happened, save, and it lands in this client's
        history and shapes your next call with them.
      </p>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 shrink-0 font-mono text-[0.56rem] uppercase tracking-wider text-muted">
            Client
          </span>
          <CompanyLinkPicker value={company} onChange={setCompany} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 shrink-0 font-mono text-[0.56rem] uppercase tracking-wider text-muted">
            With
          </span>
          <input
            value={who}
            onChange={(e) => setWho(e.target.value)}
            placeholder="Who you spoke with (optional)"
            className="min-w-[200px] flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none placeholder:text-muted/50 focus:border-amber/60"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-bone">
              What happened on the call
            </span>
            <VoiceNoteButton
              onText={(t) =>
                setRecap((p) => (p.trim() ? `${p.trim()} ${t}` : t))
              }
            />
          </div>
          <textarea
            value={recap}
            onChange={(e) => setRecap(e.target.value)}
            rows={10}
            placeholder="Say or type what happened, in your own words. Who you spoke to, what they said, the problems or needs they raised, what you agreed, and what happens next. Tap the mic to dictate."
            className="w-full resize-y rounded-lg border border-edge bg-ink/60 px-3 py-2.5 font-sans text-sm leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60"
          />
          <p className="mt-1.5 font-mono text-[0.58rem] leading-relaxed text-muted">
            The more you say about their problems and the next step, the better
            the summary, the pain points, and your next-call intent.
          </p>
        </div>

        {err && (
          <p className="font-mono text-[0.66rem] text-rust">{err}</p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="self-start rounded-full border border-amber/60 bg-amber/15 px-6 py-2.5 font-mono text-[0.64rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
        >
          {saving ? "saving the call…" : "save call"}
        </button>
      </div>

      <NavMenu />
    </main>
  );
}

export default function LogCallPage() {
  return (
    <Suspense
      fallback={
        <main className="relative z-10 mx-auto max-w-[720px] px-5 py-10">
          <p className="font-mono text-[0.66rem] text-muted">Loading…</p>
        </main>
      }
    >
      <LogCallInner />
    </Suspense>
  );
}
