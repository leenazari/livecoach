"use client";

import { useEffect, useRef, useState } from "react";
import { crmFetch } from "@/lib/crm";
import { foldDictationEvent } from "@/lib/dictation";

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

export default function QuickClientUpdate({
  companyId,
  companyName,
  onSaved,
}: {
  companyId: string;
  companyName: string;
  onSaved: (item: QuickUpdateItem) => void;
}) {
  const [type, setType] = useState<(typeof UPDATE_TYPES)[number]["key"]>("phone");
  const [note, setNote] = useState("");
  const [listening, setListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const recognitionRef = useRef<any>(null);
  const baseRef = useRef("");
  const noteRef = useRef("");

  useEffect(() => {
    noteRef.current = note;
  }, [note]);

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
      const result = await crmFetch<{ item: QuickUpdateItem }>(
        `/api/crm/companies/${companyId}/context`,
        {
          method: "POST",
          body: JSON.stringify({
            kind: "note",
            title: selected.label,
            content,
          }),
        }
      );
      setNote("");
      setNotice(`${selected.label} saved to ${companyName}.`);
      onSaved(result.item);
      window.dispatchEvent(new CustomEvent("lc:crm-updated"));
      window.dispatchEvent(new CustomEvent("lc:client-context-updated", { detail: { companyId } }));
    } catch (caught: any) {
      setError(caught?.message || "That update did not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-3 rounded-xl border border-sky/40 bg-sky/[0.05] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-sky">
            ＋ Log an update
          </p>
          <p className="mt-1 font-sans text-[0.74rem] text-bone/65">
            Phone calls, texts and voice notes feed the timeline, Brain and next-call intent.
          </p>
        </div>
        {notice ? (
          <span className="font-mono text-[0.54rem] uppercase tracking-wider text-sage">✓ {notice}</span>
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

      {error ? <p className="mt-2 font-sans text-[0.74rem] text-rust">{error}</p> : null}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving || !note.trim()}
          className="min-h-10 rounded-full border border-sky/60 bg-sky/15 px-4 py-1.5 font-mono text-[0.56rem] uppercase tracking-wider text-sky transition hover:bg-sky/25 disabled:opacity-40"
        >
          {saving ? "saving…" : `save ${selected.label.toLowerCase()}`}
        </button>
      </div>
    </section>
  );
}
