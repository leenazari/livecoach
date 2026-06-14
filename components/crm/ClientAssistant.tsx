"use client";

import { useEffect, useRef, useState } from "react";
import { crmFetch } from "@/lib/crm";

type Msg = { id?: string; role: string; content: string };

// Per-client AI assistant: a chat grounded in everything we know about the
// client. Talk to it (tap the mic to start, tap again to stop - browser speech)
// or type, and it can read its answers aloud. Always explains its reasoning.
export default function ClientAssistant({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const recRef = useRef<any>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    crmFetch<{ messages: Msg[] }>(`/api/crm/companies/${companyId}/assistant`)
      .then((d) => setMessages(d.messages || []))
      .catch(() => {});
  }, [companyId]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const speak = (text: string) => {
    if (
      !readAloud ||
      typeof window === "undefined" ||
      !(window as any).speechSynthesis
    )
      return;
    try {
      const synth = (window as any).speechSynthesis;
      synth.cancel();
      const u = new (window as any).SpeechSynthesisUtterance(text);
      u.rate = 1.03;
      synth.speak(u);
    } catch {
      /* ignore */
    }
  };

  const send = async (text?: string) => {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    setInput("");
    setMessages((p) => [...p, { role: "user", content: t }]);
    setBusy(true);
    try {
      const { reply } = await crmFetch<{ reply: string }>("/api/crm/assistant", {
        method: "POST",
        body: JSON.stringify({ companyId, message: t }),
      });
      setMessages((p) => [...p, { role: "assistant", content: reply }]);
      speak(reply);
    } catch (e: any) {
      setMessages((p) => [
        ...p,
        { role: "assistant", content: `(couldn't answer: ${e.message})` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = () => {
    const SR =
      (window as any).webkitSpeechRecognition ||
      (window as any).SpeechRecognition;
    if (!SR) {
      alert("Voice input needs a Chromium browser (Chrome, Edge, Arc).");
      return;
    }
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = "en-GB";
    rec.interimResults = true;
    rec.continuous = true;
    let finalText = "";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setInput((finalText + interim).trim());
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  const clearThread = async () => {
    if (!confirm("Clear this assistant conversation?")) return;
    setMessages([]);
    crmFetch(`/api/crm/companies/${companyId}/assistant`, {
      method: "DELETE",
    }).catch(() => {});
  };

  const chips = [
    "What do I do next to win this?",
    "Draft a scope document from our calls",
    "What are the risks with this client?",
    "Prep me for the next call",
  ];

  return (
    <section className="rounded-xl border border-amber/40 bg-amber/[0.04] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          {"▤"} Assistant{" "}
          <span className="text-muted">- ask anything about {companyName}</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReadAloud((v) => !v)}
            title="read answers aloud"
            className={`rounded-full border px-2.5 py-1 font-mono text-[0.54rem] uppercase tracking-wider transition ${
              readAloud
                ? "border-sky/60 bg-sky/15 text-sky"
                : "border-edge text-muted hover:text-bone"
            }`}
          >
            {"\u{1F50A}"} read aloud {readAloud ? "on" : "off"}
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearThread}
              title="clear conversation"
              className="rounded-full border border-edge px-2.5 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-muted transition hover:text-rust"
            >
              clear
            </button>
          )}
        </div>
      </div>

      <div
        ref={threadRef}
        className="mb-3 flex max-h-[420px] min-h-[120px] flex-col gap-2.5 overflow-y-auto"
      >
        {messages.length === 0 && !busy && (
          <div>
            <p className="mb-2 font-sans text-[0.82rem] leading-relaxed text-bone/70">
              I know everything on {companyName} - every call, the focus scores,
              opportunities, follow-ups and your notes. Ask me how to move the
              relationship forward and I'll explain the thinking.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => send(c)}
                  className="rounded-full border border-edge px-2.5 py-1 font-mono text-[0.6rem] text-muted transition hover:border-amber/50 hover:text-amber"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={m.id || i}
            className={
              m.role === "user" ? "flex justify-end" : "flex justify-start"
            }
          >
            <div
              className={`max-w-[88%] rounded-xl px-3 py-2 font-sans text-[0.84rem] leading-relaxed ${
                m.role === "user"
                  ? "border border-amber/30 bg-amber/15 text-amber/90"
                  : "border border-edge bg-ink/40 text-bone/90"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.role === "assistant" && (
                <div className="mt-1.5 flex gap-3">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(m.content)}
                    className="font-mono text-[0.54rem] uppercase tracking-wider text-muted transition hover:text-amber"
                  >
                    copy
                  </button>
                  <button
                    type="button"
                    onClick={() => speak(m.content)}
                    className="font-mono text-[0.54rem] uppercase tracking-wider text-muted transition hover:text-sky"
                  >
                    {"\u{1F50A}"} play
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="rounded-xl border border-edge bg-ink/40 px-3 py-2 font-mono text-[0.7rem] text-muted">
              thinking…
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleMic}
          title={listening ? "tap to stop" : "tap to speak"}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm transition ${
            listening
              ? "border-rust bg-rust text-white"
              : "border-amber/60 bg-amber/15 text-amber hover:bg-amber/25"
          }`}
        >
          {listening ? "⏹" : "\u{1F3A4}"}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={listening ? "listening… tap mic to stop" : "Ask, or tap the mic to talk…"}
          className="flex-1 rounded-full border border-edge bg-ink/60 px-4 py-2 font-sans text-sm text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60"
        />
        <button
          type="button"
          onClick={() => send()}
          disabled={busy || !input.trim()}
          className="shrink-0 rounded-full border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
        >
          ask
        </button>
      </div>
    </section>
  );
}
