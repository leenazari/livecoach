"use client";

import { useEffect, useRef, useState } from "react";

import { crmFetch } from "@/lib/crm";
import { foldDictationEvent } from "@/lib/dictation";

const OUTCOMES = [
  ["connected", "Connected"],
  ["meeting_booked", "Meeting booked"],
  ["callback_requested", "Call back requested"],
  ["voicemail", "Left voicemail"],
  ["no_answer", "No answer"],
  ["not_now", "Not now"],
  ["wrong_contact", "Wrong contact"],
  ["not_interested", "Not interested"],
  ["do_not_contact", "Do not contact"],
] as const;

type Outcome = (typeof OUTCOMES)[number][0];

const NEXT_ACTIONS: Record<Outcome, string> = {
  connected: "Follow up on the agreed point from the call",
  meeting_booked: "Prepare for the booked meeting",
  callback_requested: "Call back at the agreed time",
  voicemail: "Send a short follow up and retry the call",
  no_answer: "Call again at a different time",
  not_now: "Reconnect at the agreed time",
  wrong_contact: "Find and contact the correct decision maker",
  not_interested: "No further follow up",
  do_not_contact: "Do not contact again",
};

const input =
  "w-full rounded-lg border border-edge bg-ink/55 px-3 py-2.5 text-sm text-bone outline-none placeholder:text-muted/55 focus:border-sky/60";

export default function ProspectManualCall({
  prospect,
  campaignId,
  onSaved,
  onCancel,
}: {
  prospect: Record<string, any>;
  campaignId?: string | null;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome>("connected");
  const [note, setNote] = useState("");
  const [nextAction, setNextAction] = useState(NEXT_ACTIONS.connected);
  const [followUpDate, setFollowUpDate] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [listening, setListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef<any>(null);
  const noteRef = useRef("");
  const baseRef = useRef("");

  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  useEffect(
    () => () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Recognition may already be stopped.
      }
    },
    []
  );

  const changeOutcome = (value: Outcome) => {
    setOutcome(value);
    setNextAction(NEXT_ACTIONS[value]);
    if (value === "not_interested" || value === "do_not_contact") {
      setFollowUpDate("");
    }
  };

  const toggleVoice = () => {
    const SpeechRecognition =
      (window as any).webkitSpeechRecognition ||
      (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice notes need Chrome, Edge or another Chromium browser.");
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
    baseRef.current = noteRef.current.trim()
      ? `${noteRef.current.trim()} `
      : "";
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
      setError("I could not hear that clearly. Tap the microphone and try again.");
    };
    recognitionRef.current = recognition;
    setError("");
    setListening(true);
    recognition.start();
  };

  const save = async () => {
    if (saving || note.trim().length < 3) return;
    setSaving(true);
    setError("");
    try {
      await crmFetch(`/api/crm/outreach/${prospect.id}/manual-call`, {
        method: "POST",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          campaignId: campaignId || null,
          outcome,
          note: note.trim(),
          nextAction: nextAction.trim(),
          followUpDate: followUpDate || null,
          durationMinutes: durationMinutes === "" ? null : Number(durationMinutes),
          occurredAt: new Date().toISOString(),
        }),
      });
      window.dispatchEvent(new CustomEvent("lc:outreach-updated"));
      window.dispatchEvent(new CustomEvent("lc:crm-updated"));
      await onSaved();
    } catch (caught: any) {
      setError(caught?.message || "That call did not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const terminal = outcome === "not_interested" || outcome === "do_not_contact";
  const name = [prospect.first_name, prospect.last_name].filter(Boolean).join(" ");

  return (
    <section className="rounded-xl border border-sky/45 bg-sky/[0.06] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[0.55rem] uppercase tracking-wider text-sky">
            Log manual call
          </p>
          <h4 className="mt-1 font-display text-lg text-bone">
            {name || prospect.company_name}
          </h4>
          <p className="mt-1 text-xs leading-5 text-muted">
            The call saves immediately. A short intelligence pass runs in the background and never replaces your factual note or chosen next action.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="min-h-10 px-2 font-mono text-[0.55rem] uppercase text-muted">
          Close
        </button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[0.8fr_1.4fr]">
        <div className="grid content-start gap-3">
          <label>
            <span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">What happened</span>
            <select value={outcome} onChange={(event) => changeOutcome(event.target.value as Outcome)} className={input}>
              {OUTCOMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">Minutes</span>
              <input type="number" min="0" max="480" inputMode="numeric" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} placeholder="Optional" className={input} />
            </label>
            <label>
              <span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">Next date</span>
              <input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} disabled={terminal} className={input} />
            </label>
          </div>
        </div>

        <div className="grid gap-3">
          <label>
            <span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">Call notes</span>
            <div className="flex items-stretch gap-2">
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder="What they said, what changed, and what needs to happen next" className={`${input} min-w-0 flex-1 resize-y`} />
              <button type="button" onClick={toggleVoice} aria-label={listening ? "Stop voice note" : "Start voice note"} className={`w-12 shrink-0 rounded-lg border text-lg ${listening ? "border-rust bg-rust/20 text-rust" : "border-sky/50 bg-sky/10 text-sky"}`}>
                {listening ? "■" : "🎤"}
              </button>
            </div>
          </label>
          <label>
            <span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">Next action</span>
            <input value={nextAction} onChange={(event) => setNextAction(event.target.value)} disabled={terminal} className={input} />
          </label>
        </div>
      </div>

      {error ? <p role="alert" className="mt-3 text-sm text-rust">{error}</p> : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={saving} className="min-h-11 rounded-lg border border-edge px-4 font-mono text-[0.58rem] uppercase text-muted">Cancel</button>
        <button type="button" onClick={save} disabled={saving || note.trim().length < 3} className="min-h-11 rounded-lg border border-sky/60 bg-sky/15 px-4 font-mono text-[0.58rem] uppercase text-sky disabled:opacity-40">
          {saving ? "Saving call…" : "Save call and next step"}
        </button>
      </div>
    </section>
  );
}
