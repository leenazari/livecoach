"use client";

import { useEffect, useId, useRef, useState } from "react";
import { crmConfirmationError, crmFetch } from "@/lib/crm";
import { foldDictationEvent, stabiliseLiveDictationPreview } from "@/lib/dictation";
import type { NotificationActionReceipt } from "@/lib/notification-actions";

const input = "w-full rounded-lg border border-edge bg-ink/60 p-3 text-sm text-bone outline-none focus:border-amber/60";
const button = "min-h-11 rounded-lg border border-edge px-4 py-2 text-sm text-bone disabled:opacity-45";

export default function NotificationActionComposer({ notificationId, title, onSaved, onClose }: {
  notificationId: string; title: string;
  onSaved: (receipt: NotificationActionReceipt) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState("note");
  const [complete, setComplete] = useState(true);
  const [nextAction, setNextAction] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [listening, setListening] = useState<"note" | "next" | null>(null);
  const requestId = useRef("");
  const recognition = useRef<any>(null);
  const keepListening = useRef(false);
  const values = useRef({ note, nextAction });
  values.current = { note, nextAction };
  const uid = useId();
  const busy = useRef(false);

  function stopVoice() {
    keepListening.current = false;
    const current = recognition.current;
    recognition.current = null;
    setListening(null);
    try { current?.stop(); } catch { /* already ended */ }
  }
  useEffect(() => () => {
    keepListening.current = false;
    const current = recognition.current;
    recognition.current = null;
    try { current?.abort(); } catch { /* already ended */ }
  }, []);

  function startVoice(target: "note" | "next") {
    const Speech = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Speech) { setError("Voice input needs Chrome or Edge. You can still type your update."); return; }
    stopVoice();
    const current = new Speech();
    const base = (target === "note" ? values.current.note : values.current.nextAction).trim();
    let committed = "", preview = base;
    current.lang = "en-GB"; current.continuous = true; current.interimResults = true;
    current.onresult = (event: any) => {
      if (recognition.current !== current) return;
      const folded = foldDictationEvent(committed, event.results);
      committed = folded.committed;
      const final = Array.from(event.results || []).some((result: any) => result.isFinal);
      preview = stabiliseLiveDictationPreview(preview, `${base} ${folded.text}`.trim(), final);
      if (target === "note") { values.current.note = preview; setNote(preview); }
      else { values.current.nextAction = preview; setNextAction(preview); }
    };
    current.onend = () => {
      if (recognition.current !== current) return;
      recognition.current = null;
      if (keepListening.current) window.setTimeout(() => {
        if (keepListening.current && !recognition.current) startVoice(target);
      }, 100);
      else setListening(null);
    };
    current.onerror = (event: any) => {
      if (["no-speech", "aborted"].includes(event?.error)) return;
      stopVoice(); setError("The microphone stopped. Your words are kept here. You can type or try again.");
    };
    recognition.current = current; keepListening.current = true; setListening(target); setError("");
    try { current.start(); } catch { stopVoice(); setError("The microphone could not start. You can type or try again."); }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    stopVoice();
    if (!note.trim() || note.length > 4000 || nextAction.length > 600) {
      setError("Describe the action in up to 4,000 characters and the next step in up to 600."); return;
    }
    if (due && !nextAction.trim()) { setError("Add the next step for that due date."); return; }
    busy.current = true; setSaving(true); setError("");
    requestId.current ||= crypto.randomUUID();
    try {
      const receipt = await crmFetch<NotificationActionReceipt>(`/api/crm/notifications/${notificationId}/action`, {
        method: "POST", body: JSON.stringify({ requestId: requestId.current, mode: "log", note, channel,
          complete, nextAction, dueAt: due ? new Date(due).toISOString() : null }),
      });
      if (receipt.ok !== true || !receipt.contextId) throw crmConfirmationError({
        url: `/api/crm/notifications/${notificationId}/action`,
        reason: "LiveCoach did not receive a complete confirmation for your note",
      });
      onSaved(receipt);
    } catch (reason: any) { setError(reason?.message || "Your action could not be saved. Your note is still here."); }
    finally { busy.current = false; setSaving(false); }
  }

  return <form onSubmit={save} className="mt-4 space-y-4 rounded-xl border border-sky/40 bg-sky/5 p-4" aria-label={`Log action for ${title}`}>
    <div><h3 className="text-base font-medium text-bone">What did you do?</h3>
      <p className="mt-1 text-sm text-muted">Save what actually happened to the client log. Nothing is drafted, sent or booked.</p></div>
    <fieldset disabled={saving} className="space-y-4">
      <label className="block text-sm text-bone">Action type
        <select value={channel} onChange={e => setChannel(e.target.value)} className={`${input} mt-1`}>
          <option value="note">Update / other action</option><option value="phone">Phone call</option>
          <option value="email">Email</option><option value="linkedin">LinkedIn</option>
          <option value="video_call">Video call</option><option value="in_person">In person</option><option value="other">Other</option>
        </select>
      </label>
      <div><label htmlFor={`${uid}-note`} className="block text-sm text-bone">Actions taken</label>
        <textarea id={`${uid}-note`} value={note} onChange={e => { stopVoice(); setNote(e.target.value); }} rows={5}
          maxLength={4000} required className={`${input} mt-1`} placeholder="I called Ben. We agreed…" />
        <button type="button" className={`${button} mt-2`} aria-pressed={listening === "note"}
          onClick={() => listening === "note" ? stopVoice() : startVoice("note")}>
          {listening === "note" ? "Stop speaking" : "Speak actions"}
        </button>
      </div>
      <details><summary className="min-h-10 cursor-pointer text-sm text-sky">Add a next step and reminder</summary>
        <label htmlFor={`${uid}-next`} className="block text-sm text-bone">Next step</label>
        <textarea id={`${uid}-next`} value={nextAction} onChange={e => { stopVoice(); setNextAction(e.target.value); }}
          rows={2} maxLength={600} className={`${input} mt-1`} placeholder="Send the agreed information on Friday" />
        <button type="button" className={`${button} mt-2`} aria-pressed={listening === "next"}
          onClick={() => listening === "next" ? stopVoice() : startVoice("next")}>
          {listening === "next" ? "Stop speaking" : "Speak next step"}
        </button>
        <label className="mt-3 block text-sm text-bone">Due date and time, in your device’s timezone
          <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} className={`${input} mt-1`} />
        </label>
        <p className="mt-2 text-xs text-muted">Creates your own task. If there is one matching active deal, its next action is updated too. Separate projects are never guessed.</p>
      </details>
      <label className="flex min-h-11 items-center gap-3 text-sm text-bone">
        <input type="checkbox" checked={complete} onChange={e => setComplete(e.target.checked)} />
        Mark this notification’s action done
      </label>
      <p className="text-xs text-muted">Your note is available for the next call’s focus. Existing intent and manual focus stay unchanged until you choose to refresh.</p>
      {listening ? <p role="status" className="text-sm text-sky">Listening. Your words stay visible while you speak.</p> : null}
      {error ? <p role="alert" className="text-sm text-rust">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving || !note.trim()} className={`${button} border-amber/50 bg-amber/10 text-amber`}>{saving ? "Saving…" : "Save action"}</button>
        <button type="button" onClick={() => { stopVoice(); onClose(); }} className={button}>Cancel</button>
      </div>
    </fieldset>
  </form>;
}
