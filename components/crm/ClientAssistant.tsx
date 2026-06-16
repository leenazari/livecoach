"use client";

import { useEffect, useRef, useState } from "react";
import { crmFetch } from "@/lib/crm";

type Msg = { id?: string; role: string; content: string; actions?: any[] };

// Splits an assistant reply into prose and sendable DRAFT blocks (wrapped by the
// model in ---DRAFT--- … ---END DRAFT--- markers) so each draft gets its own
// one-click copy.
function splitDrafts(content: string): { type: "text" | "draft"; text: string }[] {
  const parts: { type: "text" | "draft"; text: string }[] = [];
  const re = /---DRAFT---\s*([\s\S]*?)\s*---END DRAFT---/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last)
      parts.push({ type: "text", text: content.slice(last, m.index) });
    parts.push({ type: "draft", text: m[1].trim() });
    last = re.lastIndex;
  }
  if (last < content.length)
    parts.push({ type: "text", text: content.slice(last) });
  return parts;
}

// Per-client AI assistant: a chat grounded in everything we know about the
// client. Talk to it (tap the mic to start, tap again to stop - browser speech)
// or type, and it can read its answers aloud. Always explains its reasoning.
export default function ClientAssistant({
  companyId,
  companyName,
  focusCompanyId,
  autoListen,
  initialPrompt,
  draftTaskId,
}: {
  companyId?: string;
  companyName?: string;
  // The client the user is currently looking at (from the page URL). Used to
  // lead the answer and to save drafts, WITHOUT scoping the conversation thread.
  focusCompanyId?: string;
  autoListen?: boolean;
  initialPrompt?: string;
  draftTaskId?: string;
}) {
  // No companyId = the GLOBAL assistant: it knows every client + the pipeline.
  const isGlobal = !companyId;
  const threadUrl = companyId
    ? `/api/crm/companies/${companyId}/assistant`
    : `/api/crm/assistant/thread`;
  const label = companyName || "your clients";
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const [savedDrafts, setSavedDrafts] = useState<Record<string, boolean>>({});
  // Per-proposed-action state: pending | busy | done | cancelled.
  const [actionState, setActionState] = useState<Record<string, string>>({});
  const recRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null); // ElevenLabs playback
  const ttsAbortRef = useRef<AbortController | null>(null); // in-flight tts fetch
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef(""); // latest input, for sending after the mic stops
  const sendOnStopRef = useRef(false);
  const suppressMicRef = useRef(false); // ignore late mic results after a send
  const didAutoListen = useRef(false);
  const lastSeedRef = useRef(""); // last initialPrompt auto-sent

  // Stop the mic immediately and stop it from re-filling the box (used on send).
  const killMic = () => {
    suppressMicRef.current = true;
    sendOnStopRef.current = false;
    try {
      recRef.current?.abort?.() ?? recRef.current?.stop?.();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setListening(false);
  };

  useEffect(() => {
    crmFetch<{ messages: Msg[] }>(threadUrl)
      .then((d) => setMessages(d.messages || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadUrl]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  // Stop talking NOW: abort any in-flight TTS request, stop ElevenLabs audio,
  // and cancel the browser fallback voice. Called when read-aloud is turned off
  // (the "don't play sound" tap) and on unmount - it cuts off mid-sentence.
  const stopSpeaking = () => {
    try {
      ttsAbortRef.current?.abort();
      ttsAbortRef.current = null;
    } catch {
      /* ignore */
    }
    try {
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.src = "";
        audioRef.current = null;
      }
    } catch {
      /* ignore */
    }
    try {
      (window as any).speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
  };

  // Speak a reply with the ElevenLabs voice, falling back to the browser voice
  // if TTS isn't configured or the request fails. Always cancels anything
  // already playing first so taps never overlap.
  const speak = async (text: string) => {
    if (typeof window === "undefined") return;
    stopSpeaking();
    const fallback = () => {
      try {
        const synth = (window as any).speechSynthesis;
        if (!synth) return;
        synth.cancel();
        const u = new (window as any).SpeechSynthesisUtterance(text);
        u.rate = 1.03;
        synth.speak(u);
      } catch {
        /* ignore */
      }
    };
    try {
      const ctrl = new AbortController();
      ttsAbortRef.current = ctrl;
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("tts unavailable");
      const blob = await res.blob();
      if (ctrl.signal.aborted) return; // muted while fetching
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
      };
      await audio.play();
    } catch (e: any) {
      if (e?.name === "AbortError") return; // deliberate stop, stay silent
      fallback();
    }
  };

  // Stop talking if the component goes away.
  useEffect(() => () => stopSpeaking(), []);

  const send = async (text?: string) => {
    const t = (text ?? inputRef.current ?? input).trim();
    if (!t || busy) return;
    // If the mic is still running when they hit Ask, stop it and don't let a
    // late transcript re-populate the box. Then clear the field.
    if (listening || recRef.current) killMic();
    setInput("");
    inputRef.current = "";
    setMessages((p) => [...p, { role: "user", content: t }]);
    setBusy(true);
    try {
      const { reply, createdTasks, proposedActions } = await crmFetch<{
        reply: string;
        createdTasks?: { id: string }[];
        proposedActions?: any[];
      }>("/api/crm/assistant", {
        method: "POST",
        body: JSON.stringify({
          companyId: companyId ?? null,
          focusCompanyId: focusCompanyId ?? null,
          message: t,
        }),
      });
      const n = createdTasks?.length || 0;
      const note = n ? `\n\n✓ Added ${n} to your to-do list.` : "";
      setMessages((p) => [
        ...p,
        { role: "assistant", content: reply + note, actions: proposedActions || [] },
      ]);
      // Tell any open to-do list to refresh so the new items show right away.
      if (n) window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      if (readAloud) speak(reply);
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
      // Deliberate stop = "I'm done talking" -> send what was heard.
      sendOnStopRef.current = true;
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = "en-GB";
    rec.interimResults = true;
    rec.continuous = true;
    suppressMicRef.current = false; // fresh dictation session
    let finalText = "";
    rec.onresult = (e: any) => {
      if (suppressMicRef.current) return; // a send already consumed this
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      const text = (finalText + interim).trim();
      inputRef.current = text;
      setInput(text);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      if (sendOnStopRef.current) {
        sendOnStopRef.current = false;
        const t = inputRef.current.trim();
        if (t) send(t);
      }
    };
    rec.onerror = () => {
      setListening(false);
      sendOnStopRef.current = false;
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  // Talk straight away: start listening as soon as the assistant is opened.
  useEffect(() => {
    if (autoListen && !didAutoListen.current) {
      didAutoListen.current = true;
      const t = setTimeout(() => toggleMic(), 350);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoListen]);

  // Seeded prompt (e.g. from a "draft email" task) - send it once.
  useEffect(() => {
    const p = (initialPrompt || "").trim();
    if (p && p !== lastSeedRef.current) {
      lastSeedRef.current = p;
      send(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  // Save an assistant-written draft into this client's follow-ups, so it lands
  // in your drafts board + dashboard count. Splits a leading "Subject:" line.
  const saveDraft = async (key: string, text: string) => {
    const target = companyId || focusCompanyId;
    if (!target) return; // no single client to save against
    const sm = text.match(/^subject:\s*(.+)$/im);
    const subject = sm ? sm[1].trim() : "Follow-up";
    const body = sm ? text.replace(/^subject:.*$/im, "").trim() : text;
    setSavedDrafts((p) => ({ ...p, [key]: true }));
    try {
      await crmFetch("/api/crm/follow-ups", {
        method: "POST",
        body: JSON.stringify({
          companyId: target,
          draft_subject: subject,
          draft_body: body,
        }),
      });
      // Close the loop: if this draft came from an email task, tick that task
      // done now that it's written and filed.
      if (draftTaskId) {
        crmFetch(`/api/crm/tasks/${draftTaskId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "done" }),
        }).catch(() => {});
      }
    } catch {
      setSavedDrafts((p) => ({ ...p, [key]: false }));
    }
  };

  // A proposed write action only runs when the user taps Confirm. It fires the
  // ready-made request the server resolved (set link, set intent, link client,
  // dismiss) and refreshes any open lists.
  const confirmAction = async (a: any) => {
    if (!a || !a.endpoint) return;
    setActionState((s) => ({ ...s, [a.key]: "busy" }));
    try {
      await crmFetch(a.endpoint, {
        method: a.method || "PATCH",
        body: JSON.stringify(a.body || {}),
      });
      setActionState((s) => ({ ...s, [a.key]: "done" }));
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    } catch {
      setActionState((s) => ({ ...s, [a.key]: "pending" }));
    }
  };
  const cancelAction = (a: any) =>
    setActionState((s) => ({ ...s, [a.key]: "cancelled" }));

  const clearThread = async () => {
    if (!confirm("Clear this assistant conversation?")) return;
    setMessages([]);
    crmFetch(threadUrl, { method: "DELETE" }).catch(() => {});
  };

  const chips = isGlobal
    ? [
        "What's my to-do list today?",
        "Which deal is closest to closing?",
        "Who have I gone quiet on?",
        "What should I prioritise this week?",
      ]
    : [
        "What do I do next to win this?",
        "Draft a scope document from our calls",
        "What are the risks with this client?",
        "Prep me for the next call",
      ];

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col rounded-xl border border-amber/40 bg-amber/[0.04] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          {"▤"} Assistant{" "}
          <span className="text-muted">- ask anything about {label}</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next = !readAloud;
              if (!next) stopSpeaking(); // turning off stops it talking now
              setReadAloud(next);
            }}
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
        className="mb-3 flex min-h-[120px] flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain"
      >
        {messages.length === 0 && !busy && (
          <div>
            <p className="mb-2 font-sans text-[0.82rem] leading-relaxed text-bone/70">
              {isGlobal
                ? "I know all your clients and your whole pipeline - tasks, drafts, opportunities. Ask me about anyone by name, or across everyone, and I'll explain the thinking."
                : `I know everything on ${companyName} - every call, the focus scores, opportunities, follow-ups and your notes. Ask me how to move the relationship forward and I'll explain the thinking.`}
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
              className={`max-w-[88%] select-text rounded-xl px-3 py-2 font-sans text-[0.84rem] leading-relaxed ${
                m.role === "user"
                  ? "border border-amber/30 bg-amber/15 text-amber/90"
                  : "border border-edge bg-ink/40 text-bone/90"
              }`}
            >
              {m.role === "assistant" ? (
                splitDrafts(m.content).map((part, pi) =>
                  part.type === "draft" ? (
                    <div
                      key={pi}
                      className="my-2 rounded-lg border border-sky/40 bg-sky/[0.06] p-2.5"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-mono text-[0.52rem] uppercase tracking-wider text-sky">
                          {"◆"} ready to send
                        </span>
                        <span className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => navigator.clipboard?.writeText(part.text)}
                            className="rounded-full border border-sky/50 px-2.5 py-0.5 font-mono text-[0.52rem] uppercase tracking-wider text-sky transition hover:bg-sky/15"
                          >
                            copy
                          </button>
                          {(companyId || focusCompanyId) && (
                            <button
                              type="button"
                              onClick={() => saveDraft(`${i}-${pi}`, part.text)}
                              disabled={savedDrafts[`${i}-${pi}`]}
                              className="rounded-full border border-sage/50 px-2.5 py-0.5 font-mono text-[0.52rem] uppercase tracking-wider text-sage transition hover:bg-sage/15 disabled:opacity-60"
                            >
                              {savedDrafts[`${i}-${pi}`] ? "saved ✓" : "save as follow-up"}
                            </button>
                          )}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap font-sans text-[0.82rem] leading-relaxed text-bone/90">
                        {part.text}
                      </p>
                    </div>
                  ) : part.text.trim() ? (
                    <p key={pi} className="whitespace-pre-wrap">
                      {part.text.trim()}
                    </p>
                  ) : null
                )
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
              {m.role === "assistant" && (
                <div className="mt-1.5 flex gap-3">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(m.content)}
                    className="font-mono text-[0.54rem] uppercase tracking-wider text-muted transition hover:text-amber"
                  >
                    copy all
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
              {m.role === "assistant" &&
                Array.isArray(m.actions) &&
                m.actions.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {m.actions.map((a: any) => {
                      const st = actionState[a.key] || "pending";
                      if (st === "cancelled") return null;
                      return (
                        <div
                          key={a.key}
                          className="rounded-lg border border-sky/40 bg-sky/[0.06] p-2"
                        >
                          <p className="mb-1.5 font-sans text-[0.78rem] leading-snug text-bone/90">
                            {"⚙"} {a.label}
                          </p>
                          {st === "done" ? (
                            <span className="font-mono text-[0.56rem] uppercase tracking-wider text-sage">
                              ✓ done
                            </span>
                          ) : (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={st === "busy"}
                                onClick={() => confirmAction(a)}
                                className="rounded-full border border-sage/60 bg-sage/15 px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-sage transition hover:bg-sage/25 disabled:opacity-50"
                              >
                                {st === "busy" ? "doing…" : "confirm"}
                              </button>
                              <button
                                type="button"
                                disabled={st === "busy"}
                                onClick={() => cancelAction(a)}
                                className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:text-rust disabled:opacity-50"
                              >
                                cancel
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
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
          onChange={(e) => {
            inputRef.current = e.target.value;
            setInput(e.target.value);
          }}
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
