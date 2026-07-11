"use client";

import { useRef, useState } from "react";
import { getDeepgramToken, deepgramListenUrl } from "@/lib/deepgram";

// Records the mic and streams it to Deepgram (same connection as CallStage),
// calling onText with each finalised chunk - used to dictate the call brief.
export default function VoiceNoteButton({
  onText,
}: {
  onText: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    try {
      if (recRef.current && recRef.current.state !== "inactive") {
        recRef.current.stop();
      }
    } catch {
      /* noop */
    }
    if (keepAliveRef.current) clearInterval(keepAliveRef.current);
    try {
      wsRef.current?.close();
    } catch {
      /* noop */
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recRef.current = null;
    wsRef.current = null;
    streamRef.current = null;
    setRecording(false);
  };

  const start = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const token = await getDeepgramToken();

      const ws = new WebSocket(deepgramListenUrl(), ["bearer", token]);
      wsRef.current = ws;

      ws.onopen = () => {
        try {
          const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
          recRef.current = rec;
          rec.ondataavailable = (e) => {
            if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
              ws.send(e.data);
            }
          };
          rec.start(250);
        } catch (e) {
          console.error("Recorder start failed:", e);
        }
        if (keepAliveRef.current) clearInterval(keepAliveRef.current);
        keepAliveRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 3000);
        setRecording(true);
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          const text: string = data?.channel?.alternatives?.[0]?.transcript || "";
          if (!text || !data.is_final) return;
          onText(text);
        } catch {
          /* ignore keepalive / non-JSON frames */
        }
      };

      ws.onerror = () => setError("mic / transcription error");
    } catch (e: any) {
      setError(e?.message || "mic access denied");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={recording ? stop : start}
        className={`rounded-full border px-3.5 py-1.5 font-mono text-[0.65rem] uppercase tracking-wider transition ${
          recording
            ? "border-rust bg-rust/15 text-rust"
            : "border-edge text-muted hover:border-amber/50 hover:text-bone"
        }`}
      >
        {recording ? "\u25A0 stop & use" : "\u25CF record brief"}
      </button>
      {recording && (
        <span className="thinking font-mono text-[0.65rem] text-rust">
          listening...
        </span>
      )}
      {error && (
        <span className="font-mono text-[0.65rem] text-rust">! {error}</span>
      )}
    </div>
  );
}
