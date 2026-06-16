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

// Break text into speakable chunks (~280 chars, at sentence boundaries) so the
// first chunk can be generated and played fast while the rest render behind it.
function splitForSpeech(text: string): string[] {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [clean];
  const chunks: string[] = [];
  let buf = "";
  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    if (buf && (buf + " " + piece).length > 280) {
      chunks.push(buf);
      buf = piece;
    } else {
      buf = buf ? `${buf} ${piece}` : piece;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

// While a reply streams in, hide the trailing SPOKEN / TASKS / ACTIONS blocks
// (they sit at the end) until the server sends back the cleaned reply.
function visibleForDisplay(content: string): string {
  return (content || "")
    .replace(/---(SPOKEN|TASKS|ACTIONS)---[\s\S]*$/i, "")
    .trim();
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
  // Read replies aloud by default - the brain talks back.
  const [readAloud, setReadAloud] = useState(true);
  // Hands-free conversation: it listens, replies aloud, then listens again.
  const [convo, setConvo] = useState(false);
  const [savedDrafts, setSavedDrafts] = useState<Record<string, boolean>>({});
  // Per-proposed-action state: pending | busy | done | cancelled.
  const [actionState, setActionState] = useState<Record<string, string>>({});
  const recRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null); // ElevenLabs playback
  const ttsAbortRef = useRef<AbortController | null>(null); // in-flight tts fetch
  const speakSeqRef = useRef(0); // bumps each speak()/stop to cancel old playback
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef(""); // latest input, for sending after the mic stops
  const sendOnStopRef = useRef(false);
  const suppressMicRef = useRef(false); // ignore late mic results after a send
  const didAutoListen = useRef(false);
  const lastSeedRef = useRef(""); // last initialPrompt auto-sent
  const convoRef = useRef(false); // mirror of convo for the stable callbacks
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputElRef = useRef<HTMLTextAreaElement | null>(null);
  // Dictation transcript, kept so the box never shrinks or drops your last words.
  // committedRef holds the FINALISED transcript this session (only ever grows).
  const committedRef = useRef("");

  // Grow the input box with the text (typed or dictated) up to a few lines, so
  // you can always see your last lines instead of one scrolling line.
  const autosize = () => {
    const el = inputElRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

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

  // Resize the input whenever its value changes (covers dictation, which sets
  // the value outside the textarea's own onChange).
  useEffect(() => {
    autosize();
  }, [input]);

  // Stop talking NOW: abort any in-flight TTS request, stop ElevenLabs audio,
  // and cancel the browser fallback voice. Called when read-aloud is turned off
  // (the "don't play sound" tap) and on unmount - it cuts off mid-sentence.
  const stopSpeaking = () => {
    speakSeqRef.current += 1; // invalidate any chunk loop in flight
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

  // Speak a reply with the ElevenLabs voice, in CHUNKS so the first sentence
  // starts almost immediately while the rest render behind it. Prefetches the
  // next chunk while the current one plays. Falls back to the browser voice if
  // TTS isn't configured or fails. stopSpeaking() (or a new speak) cancels it.
  const speak = async (text: string, onEnd?: () => void) => {
    if (typeof window === "undefined") return onEnd?.();
    stopSpeaking();
    const seq = ++speakSeqRef.current;
    const chunks = splitForSpeech(text);
    if (!chunks.length) return onEnd?.();

    const browserFallback = (t: string) => {
      try {
        const synth = (window as any).speechSynthesis;
        if (!synth) return onEnd?.();
        synth.cancel();
        const u = new (window as any).SpeechSynthesisUtterance(t);
        u.rate = 1.03;
        u.onend = () => {
          if (seq === speakSeqRef.current) onEnd?.();
        };
        synth.speak(u);
      } catch {
        onEnd?.();
      }
    };

    // Fetch one chunk's audio. Returns the Audio + its object URL, or null.
    const genChunk = async (
      chunk: string
    ): Promise<{ audio: HTMLAudioElement; url: string } | null> => {
      try {
        const ctrl = new AbortController();
        ttsAbortRef.current = ctrl;
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: chunk }),
          signal: ctrl.signal,
        });
        if (!res.ok) return null;
        const blob = await res.blob();
        if (seq !== speakSeqRef.current) return null; // cancelled while fetching
        const url = URL.createObjectURL(blob);
        return { audio: new Audio(url), url };
      } catch {
        return null;
      }
    };

    try {
      let nextP = genChunk(chunks[0]); // start the first one now
      for (let i = 0; i < chunks.length; i++) {
        if (seq !== speakSeqRef.current) return; // stopped
        const cur = await nextP;
        // Kick off the next chunk's render while this one plays.
        nextP =
          i + 1 < chunks.length
            ? genChunk(chunks[i + 1])
            : Promise.resolve(null);
        if (seq !== speakSeqRef.current) return;
        if (!cur) {
          // ElevenLabs failed for this chunk - read the rest with the browser
          // voice rather than going silent.
          browserFallback(chunks.slice(i).join(" "));
          return;
        }
        audioRef.current = cur.audio;
        await new Promise<void>((resolve) => {
          cur.audio.onended = () => {
            URL.revokeObjectURL(cur.url);
            resolve();
          };
          cur.audio.onerror = () => {
            URL.revokeObjectURL(cur.url);
            resolve();
          };
          cur.audio.play().catch(() => resolve());
        });
        if (seq !== speakSeqRef.current) return; // stopped during playback
      }
      onEnd?.();
    } catch {
      onEnd?.();
    }
  };

  // Stop talking AND listening if the component goes away.
  useEffect(
    () => () => {
      stopSpeaking();
      convoRef.current = false;
      try {
        recRef.current?.abort?.();
      } catch {
        /* ignore */
      }
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    },
    []
  );

  const send = async (text?: string) => {
    const t = (text ?? inputRef.current ?? input).trim();
    if (!t || busy) return;
    // Silence any read-aloud still playing from the PREVIOUS reply the instant a
    // new turn starts. Without this the old answer keeps playing (or re-fires on
    // mobile) until the new reply's audio begins, so you hear the last answer
    // again before the new one. Stop it now.
    stopSpeaking();
    // If the mic is still running when they hit Ask, stop it and don't let a
    // late transcript re-populate the box. Then clear the field.
    if (listening || recRef.current) killMic();
    setInput("");
    inputRef.current = "";
    committedRef.current = "";
    // Add the user message AND an empty assistant bubble to stream the reply
    // into, so words appear as they are written.
    setMessages((p) => [
      ...p,
      { role: "user", content: t },
      { role: "assistant", content: "" },
    ]);
    setBusy(true);

    const setLastAssistant = (updater: (m: Msg) => Msg) =>
      setMessages((p) => {
        const next = [...p];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === "assistant") {
            next[i] = updater(next[i]);
            break;
          }
        }
        return next;
      });

    try {
      const res = await fetch("/api/crm/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId ?? null,
          focusCompanyId: focusCompanyId ?? null,
          message: t,
        }),
      });
      if (!res.ok || !res.body) throw new Error("the assistant is unavailable");
      // Read the newline-delimited JSON stream: {type:"delta"} as it writes,
      // then a {type:"done"} with the clean reply + actions + spoken.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let streamed = "";
      let done: any = null;
      for (;;) {
        const { value, done: rdone } = await reader.read();
        if (rdone) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let fr: any;
          try {
            fr = JSON.parse(line);
          } catch {
            continue;
          }
          if (fr.type === "delta") {
            streamed += fr.text || "";
            const shown = streamed;
            setLastAssistant((m) => ({ ...m, content: shown }));
          } else if (fr.type === "done") {
            done = fr;
          } else if (fr.type === "error") {
            throw new Error(fr.error || "assistant error");
          }
        }
      }

      const finalReply = String(done?.reply ?? streamed).trim();
      const n = done?.createdTasks?.length || 0;
      const note = n ? `\n\n✓ Added ${n} to your to-do list.` : "";
      setLastAssistant((m) => ({
        ...m,
        content: finalReply + note,
        actions: done?.proposedActions || [],
      }));
      if (n) window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      if (readAloud || convoRef.current) {
        const spoken = done?.spoken;
        const say =
          spoken && String(spoken).trim()
            ? String(spoken).trim()
            : finalReply
                .replace(
                  /---DRAFT---[\s\S]*?---END DRAFT---/g,
                  " I have written a draft for you below. "
                )
                .trim();
        speak(say, () => {
          if (convoRef.current) startListening();
        });
      }
    } catch (e: any) {
      setLastAssistant((m) => ({
        ...m,
        content: `(couldn't answer: ${e?.message || "try again"})`,
      }));
    } finally {
      setBusy(false);
    }
  };

  const startListening = () => {
    const SR =
      (window as any).webkitSpeechRecognition ||
      (window as any).SpeechRecognition;
    if (!SR) {
      alert("Voice input needs a Chromium browser (Chrome, Edge, Arc).");
      setConvo(false);
      convoRef.current = false;
      return;
    }
    // Stop the brain talking the instant we start listening, so its own voice
    // never bleeds into your recording.
    stopSpeaking();
    const rec = new SR();
    rec.lang = "en-GB";
    rec.interimResults = true;
    rec.continuous = true;
    suppressMicRef.current = false; // fresh dictation session
    committedRef.current = "";
    rec.onresult = (e: any) => {
      if (suppressMicRef.current) return; // a send already consumed this
      // Merge an accumulator with a new chunk. Desktop Chrome returns a fresh
      // SEGMENT per result, so those append. Android Chrome instead RESTATES the
      // whole phrase so far in each result (and across events) - naive
      // concatenation turned that into "sosososo theso the day...". So when the
      // new chunk restates what we already have, REPLACE rather than append, and
      // drop shorter restatements and exact tail repeats. Desktop behaviour
      // (distinct segments appended) is unchanged.
      const merge = (acc: string, seg: string) => {
        const a = (acc || "").trim();
        const s = (seg || "").trim();
        if (!a) return seg || "";
        if (!s) return acc;
        const la = a.toLowerCase();
        const ls = s.toLowerCase();
        if (ls.startsWith(la)) return seg; // chunk extends everything so far
        if (la.startsWith(ls)) return acc; // chunk is a shorter restatement
        if (la.endsWith(ls)) return acc; // chunk already sits at the tail
        const needsSpace =
          !acc.endsWith(" ") && !(seg || "").startsWith(" ");
        return acc + (needsSpace ? " " : "") + seg;
      };
      // Fold every FINAL result (stable, so this only ever grows) and keep just
      // the latest interim as the live tail.
      let finals = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const seg = e.results[i][0]?.transcript || "";
        if (e.results[i].isFinal) finals = merge(finals, seg);
        else interim = seg;
      }
      // Carry finals across events too (Android can reset its results list).
      committedRef.current = merge(committedRef.current, finals);
      const text = merge(committedRef.current, interim).replace(/\s+/g, " ").trim();
      inputRef.current = text;
      setInput(text);
      // Hands-free: when you pause for a moment, end the turn and send.
      if (convoRef.current && text) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          sendOnStopRef.current = true;
          try {
            recRef.current?.stop();
          } catch {
            /* ignore */
          }
        }, 1600);
      }
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      if (sendOnStopRef.current) {
        sendOnStopRef.current = false;
        const t = inputRef.current.trim();
        if (t) send(t);
        else if (convoRef.current) startListening(); // empty turn, keep listening
      }
    };
    rec.onerror = () => {
      setListening(false);
      sendOnStopRef.current = false;
    };
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      /* ignore a double-start */
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
    startListening();
  };

  // Hands-free loop: listen, reply aloud, then listen again until you turn it
  // off. Turning it on also turns read-aloud on (it has to talk to converse).
  const toggleConvo = () => {
    const next = !convoRef.current;
    setConvo(next);
    convoRef.current = next;
    if (next) {
      setReadAloud(true);
      if (!listening) startListening();
    } else {
      stopSpeaking();
      killMic();
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    }
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
  // When the brain wasn't sure which record you meant, it offers options. Tap
  // one to run the action against exactly that record.
  const confirmChoice = async (a: any, c: any) => {
    if (!c || !c.endpoint) return;
    setActionState((s) => ({ ...s, [a.key]: "busy" }));
    try {
      await crmFetch(c.endpoint, {
        method: c.method || "PATCH",
        body: JSON.stringify(c.body || {}),
      });
      setActionState((s) => ({ ...s, [a.key]: "done" }));
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    } catch {
      setActionState((s) => ({ ...s, [a.key]: "pending" }));
    }
  };

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
          {"▤"} The brain{" "}
          <span className="text-muted">- ask anything about {label}</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleConvo}
            title="Hands-free: talk and the brain talks back, then keeps listening. Tap to stop."
            className={`rounded-full border px-2.5 py-1 font-mono text-[0.54rem] uppercase tracking-wider transition ${
              convo
                ? "border-sage/60 bg-sage/15 text-sage"
                : "border-edge text-muted hover:text-bone"
            }`}
          >
            {convo ? "● hands-free" : "hands-free"}
          </button>
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
                splitDrafts(visibleForDisplay(m.content)).map((part, pi) =>
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
              {m.role === "assistant" && visibleForDisplay(m.content).trim() && (
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
                          ) : Array.isArray(a.choices) && a.choices.length ? (
                            <div className="flex flex-col gap-1">
                              {a.choices.map((c: any, ci: number) => (
                                <button
                                  key={ci}
                                  type="button"
                                  disabled={st === "busy"}
                                  onClick={() => confirmChoice(a, c)}
                                  className="rounded-lg border border-sage/50 bg-sage/10 px-3 py-1 text-left font-sans text-[0.76rem] text-bone/90 transition hover:bg-sage/20 disabled:opacity-50"
                                >
                                  {c.label}
                                </button>
                              ))}
                              <button
                                type="button"
                                disabled={st === "busy"}
                                onClick={() => cancelAction(a)}
                                className="self-start rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:text-rust disabled:opacity-50"
                              >
                                none of these
                              </button>
                            </div>
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

        {busy &&
          !(messages[messages.length - 1]?.content || "").trim() && (
            <div className="flex justify-start">
              <div className="rounded-xl border border-edge bg-ink/40 px-3 py-2 font-mono text-[0.7rem] text-muted">
                thinking…
              </div>
            </div>
          )}
      </div>

      <div className="flex items-end gap-2">
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
        <textarea
          ref={inputElRef}
          value={input}
          rows={1}
          onChange={(e) => {
            inputRef.current = e.target.value;
            setInput(e.target.value);
            autosize();
          }}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter makes a new line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={listening ? "listening… tap mic to stop" : "Ask, or tap the mic to talk…"}
          className="max-h-[120px] min-h-[40px] flex-1 resize-none overflow-y-auto rounded-2xl border border-edge bg-ink/60 px-4 py-2 font-sans text-sm leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60"
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
