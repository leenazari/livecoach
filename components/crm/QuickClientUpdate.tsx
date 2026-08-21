"use client";

import { useEffect, useRef, useState } from "react";
import { crmFetch } from "@/lib/crm";
import { foldDictationEvent } from "@/lib/dictation";
import { capitaliseSentenceStarts } from "@/lib/text";
import {
  activityHasActions,
  type ActivityIntelligence,
} from "@/lib/activity-intelligence";

export type QuickUpdateItem = {
  id: string;
  title: string | null;
  content: string | null;
  created_at: string;
};

const UPDATE_TYPES = [
  { key: "phone", label: "Phone call", icon: "☎" },
  { key: "text", label: "Text message", icon: "▤" },
  { key: "voice", label: "Voice note", icon: "🎤" },
  { key: "note", label: "General note", icon: "✎" },
] as const;

const OWNER_LABELS = { us: "you", buyer: "them", joint: "joint" } as const;

export default function QuickClientUpdate({
  companyId,
  companyName,
  onSaved,
  onApplied,
  initialIntelligence,
  sharedSalesAccess = false,
}: {
  companyId: string;
  companyName: string;
  onSaved: (item: QuickUpdateItem) => void;
  onApplied?: () => void | Promise<void>;
  initialIntelligence?: ActivityIntelligence | null;
  sharedSalesAccess?: boolean;
}) {
  const [type, setType] = useState<(typeof UPDATE_TYPES)[number]["key"]>("phone");
  const [note, setNote] = useState("");
  const [listening, setListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [intelligence, setIntelligence] = useState<ActivityIntelligence | null>(
    initialIntelligence || null
  );
  const recognitionRef = useRef<any>(null);
  const baseRef = useRef("");
  const noteRef = useRef("");

  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  useEffect(() => {
    if (initialIntelligence) setIntelligence(initialIntelligence);
  }, [initialIntelligence]);

  useEffect(
    () => () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* recognition may already be stopped */
      }
    },
    []
  );

  const selected = UPDATE_TYPES.find((item) => item.key === type) || UPDATE_TYPES[0];

  const toggleVoice = () => {
    const SpeechRecognition =
      (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice input needs Chrome, Edge or another Chromium browser.");
      return;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-GB";
    recognition.interimResults = true;
    recognition.continuous = true;
    baseRef.current = noteRef.current.trim() ? `${noteRef.current.trim()} ` : "";
    let committed = "";
    recognition.onresult = (event: any) => {
      const folded = foldDictationEvent(committed, event.results);
      committed = folded.committed;
      setNote((baseRef.current + folded.text).trim());
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognition.onerror = () => {
      recognitionRef.current = null;
      setListening(false);
      setError("I couldn't hear that clearly. Tap the microphone and try again.");
    };
    recognitionRef.current = recognition;
    setError("");
    setListening(true);
    recognition.start();
  };

  const save = async () => {
    const content = note.trim();
    if (!content || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<{
        item: QuickUpdateItem;
        intelligence: ActivityIntelligence | null;
        warning?: string;
      }>(
        `/api/crm/companies/${companyId}/activity`,
        {
          method: "POST",
          body: JSON.stringify({
            channel: type,
            content,
          }),
        }
      );
      setNote("");
      setIntelligence(result.intelligence || null);
      setNotice(
        result.warning ||
          `${selected.label} saved and its commercial meaning is ready.`
      );
      onSaved(result.item);
      window.dispatchEvent(new CustomEvent("lc:crm-updated"));
      window.dispatchEvent(new CustomEvent("lc:client-context-updated", { detail: { companyId } }));
    } catch (caught: any) {
      setError(caught?.message || "That update did not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const approvePlan = async () => {
    if (!intelligence || intelligence.status === "applied" || approving) return;
    setApproving(true);
    setError("");
    try {
      const result = await crmFetch<{
        intelligence: ActivityIntelligence;
        applied: string[];
        warnings: string[];
      }>(`/api/crm/companies/${companyId}/activity/approve`, {
        method: "POST",
        body: JSON.stringify({ contextId: intelligence.contextId }),
      });
      setIntelligence(result.intelligence);
      setNotice(
        result.applied.length
          ? `${result.applied.length} CRM ${result.applied.length === 1 ? "change" : "changes"} applied.`
          : "The insight is saved. No additional CRM change was needed."
      );
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      window.dispatchEvent(new CustomEvent("lc:crm-updated"));
      await onApplied?.();
    } catch (caught: any) {
      setError(caught?.message || "That plan did not save. Please try again.");
    } finally {
      setApproving(false);
    }
  };

  const hasActions = activityHasActions(intelligence);

  return (
    <section className="mb-3 rounded-xl border border-sky/40 bg-sky/[0.05] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-sky">
            ＋ Log an update
          </p>
          <p className="mt-1 font-sans text-[0.74rem] text-bone/65">
            {sharedSalesAccess
              ? "Phone calls, texts and voice notes feed your private timeline and Brain context. The original owner's private history stays closed."
              : "Phone calls, texts and voice notes feed the timeline and Brain. One small Luna pass finds the commercial next move."}
          </p>
        </div>
        {notice ? (
          <span
            role="status"
            aria-live="polite"
            className="font-mono text-[0.54rem] uppercase tracking-wider text-sage"
          >
            ✓ {notice}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
        {UPDATE_TYPES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setType(item.key);
              setNotice("");
            }}
            className={`shrink-0 rounded-full border px-3 py-1.5 font-mono text-[0.54rem] uppercase tracking-wider transition ${
              type === item.key
                ? "border-sky/60 bg-sky/15 text-sky"
                : "border-edge text-muted hover:text-bone"
            }`}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-stretch gap-2">
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          aria-label={`${selected.label} update for ${companyName}`}
          placeholder={
            type === "phone"
              ? "What was discussed, what changed, and what happens next?"
              : type === "text"
                ? "What did they text, and what does it mean for the next step?"
                : "Speak or type the important update…"
          }
          className="min-w-0 flex-1 resize-y rounded-lg border border-edge bg-ink/65 px-3 py-2 font-sans text-sm leading-relaxed text-bone outline-none placeholder:text-muted/55 focus:border-sky/60"
        />
        <button
          type="button"
          onClick={toggleVoice}
          aria-label={listening ? "Stop voice note" : "Start voice note"}
          className={`w-12 shrink-0 rounded-lg border text-lg transition ${
            listening
              ? "border-rust bg-rust/20 text-rust"
              : "border-sky/50 bg-sky/10 text-sky hover:bg-sky/20"
          }`}
        >
          {listening ? "■" : "🎤"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 font-sans text-[0.74rem] text-rust">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving || !note.trim()}
          className="min-h-11 w-full rounded-full border border-sky/60 bg-sky/15 px-4 py-1.5 font-mono text-[0.56rem] uppercase tracking-wider text-sky transition hover:bg-sky/25 disabled:opacity-40 sm:w-auto"
        >
          {saving
            ? "saving & analysing…"
            : `save & analyse ${selected.label.toLowerCase()}`}
        </button>
      </div>

      {intelligence ? (
        <section className="mt-3 rounded-xl border border-amber/40 bg-amber/[0.055] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[0.56rem] uppercase tracking-[0.16em] text-amber">
              Commercial read
            </p>
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[0.48rem] uppercase tracking-wider ${
                intelligence.status === "applied"
                  ? "border-sage/40 bg-sage/10 text-sage"
                  : "border-amber/40 bg-amber/10 text-amber"
              }`}
            >
              {intelligence.status === "applied" ? "approved" : "review first"}
            </span>
          </div>
          <p className="mt-1.5 font-sans text-[0.82rem] leading-relaxed text-bone/90">
            {capitaliseSentenceStarts(intelligence.overview)}
          </p>

          {intelligence.buyingSignals.length || intelligence.risks.length ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {intelligence.buyingSignals.length ? (
                <div className="rounded-lg border border-sage/30 bg-sage/[0.055] p-2.5">
                  <p className="font-mono text-[0.5rem] uppercase tracking-wider text-sage">
                    Buying signals
                  </p>
                  <ul className="mt-1 space-y-1">
                    {intelligence.buyingSignals.map((signal, index) => (
                      <li key={`${signal}:${index}`} className="font-sans text-[0.72rem] leading-snug text-bone/80">
                        • {capitaliseSentenceStarts(signal)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {intelligence.risks.length ? (
                <div className="rounded-lg border border-rust/30 bg-rust/[0.055] p-2.5">
                  <p className="font-mono text-[0.5rem] uppercase tracking-wider text-rust">
                    Risks to handle
                  </p>
                  <ul className="mt-1 space-y-1">
                    {intelligence.risks.map((risk, index) => (
                      <li key={`${risk}:${index}`} className="font-sans text-[0.72rem] leading-snug text-bone/80">
                        • {capitaliseSentenceStarts(risk)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {hasActions ? (
            <div className="mt-2 rounded-lg border border-sky/30 bg-sky/[0.045] p-2.5">
              <p className="font-mono text-[0.5rem] uppercase tracking-wider text-sky">
                Approval plan
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {intelligence.nextAction ? (
                  <li className="font-sans text-[0.73rem] leading-snug text-bone/85">
                    <span className="text-sky">Next action:</span> {capitaliseSentenceStarts(intelligence.nextAction.text)}
                    {intelligence.nextAction.dueAt
                      ? `, due ${intelligence.nextAction.dueAt}`
                      : ""}
                    {` · owner ${OWNER_LABELS[intelligence.nextAction.owner]}`}
                  </li>
                ) : null}
                {intelligence.nextCallIntent ? (
                  <li className="font-sans text-[0.73rem] leading-snug text-bone/85">
                    <span className="text-sky">Next-call intent:</span> {capitaliseSentenceStarts(intelligence.nextCallIntent)}
                  </li>
                ) : null}
                {intelligence.stakeholderUpdates.map((update, index) => (
                  <li key={`${update.person}:${index}`} className="font-sans text-[0.73rem] leading-snug text-bone/85">
                    <span className="text-sky">Stakeholder:</span> set {update.person} as {update.buyingRole.replace(/_/g, " ")} because {update.evidence}
                  </li>
                ))}
                {intelligence.followUp?.body ? (
                  <li className="font-sans text-[0.73rem] leading-snug text-bone/85">
                    <span className="text-sky">Draft email:</span> {intelligence.followUp.subject}
                    <p className="mt-1 whitespace-pre-wrap rounded-md border border-edge/70 bg-ink/40 p-2 text-[0.7rem] text-bone/70">
                      {intelligence.followUp.body}
                    </p>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : (
            <p className="mt-2 font-sans text-[0.72rem] text-muted">
              No new task, draft or intent change is justified by this update.
            </p>
          )}

          {intelligence.status === "pending" && hasActions ? (
            <button
              type="button"
              onClick={approvePlan}
              disabled={approving}
              className="mt-3 min-h-11 w-full rounded-lg border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40 sm:w-auto"
            >
              {approving ? "applying plan…" : "approve plan"}
            </button>
          ) : null}

          {intelligence.status === "applied" ? (
            <div className="mt-2 border-t border-edge/60 pt-2">
              {(intelligence.applied || []).map((item, index) => (
                <p key={`${item}:${index}`} className="font-sans text-[0.7rem] leading-snug text-sage">
                  ✓ {item}
                </p>
              ))}
              {(intelligence.warnings || []).map((item, index) => (
                <p key={`${item}:${index}`} className="font-sans text-[0.7rem] leading-snug text-amber">
                  ! {item}
                </p>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
