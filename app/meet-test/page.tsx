"use client";
// FIRST LINE MARKER (page): app/meet-test/page.tsx  — "use client" + JSX
// Throwaway diagnostic harness for the Meet/Recall pipeline. Not user-facing.
import { useEffect, useRef, useState } from "react";

const WORKER_WS =
  "wss://livecoach-meet-worker-production.up.railway.app/ws";

type Line = { speaker: string; role: string; text: string; ts: string };

export default function MeetTestPage() {
  const [room, setRoom] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [botId, setBotId] = useState("");
  const [status, setStatus] = useState("idle");
  const [wsState, setWsState] = useState("disconnected");
  const [lines, setLines] = useState<Line[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setRoom("meet-test-" + Math.random().toString(36).slice(2, 8));
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  function connectWs() {
    if (!room) return;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    const ws = new WebSocket(`${WORKER_WS}?session=${encodeURIComponent(room)}`);
    wsRef.current = ws;
    setWsState("connecting");
    ws.onopen = () => setWsState("connected");
    ws.onclose = () => setWsState("disconnected");
    ws.onerror = () => setWsState("error");
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "utterance") {
          setLines((prev) => [
            ...prev,
            {
              speaker: msg.speaker || "?",
              role: msg.role || "",
              text: msg.text || "",
              ts: msg.ts || "",
            },
          ]);
        }
      } catch {
        /* ignore non-JSON */
      }
    };
  }

  async function sendBot() {
    setStatus("sending bot...");
    setLines([]);
    try {
      const r = await fetch("/api/meet/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingUrl, sessionId: room }),
      });
      const d = await r.json();
      if (!r.ok) {
        setStatus(
          "error: " + (d.error || r.status) + (d.detail ? " — " + d.detail : "")
        );
        return;
      }
      setBotId(d.botId);
      setStatus("bot joining — id " + d.botId);
      connectWs();
    } catch (e: any) {
      setStatus("error: " + e.message);
    }
  }

  async function stopBot() {
    if (!botId) return;
    setStatus("stopping...");
    try {
      const r = await fetch("/api/meet/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId }),
      });
      const d = await r.json();
      setStatus(r.ok ? "bot removed" : "stop error: " + (d.error || r.status));
    } catch (e: any) {
      setStatus("error: " + e.message);
    }
  }

  return (
    <div className="min-h-screen bg-ink text-bone p-6 font-sans">
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="font-display text-2xl text-amber">Meet pipeline test</h1>
          <p className="text-muted text-sm mt-1">
            Diagnostic only. Sends a Recall bot into a Google Meet and shows the
            live transcript relayed by the worker.
          </p>
        </div>

        <div className="bg-panel border border-edge rounded-lg p-4 space-y-3">
          <label className="block text-sm">
            <span className="text-muted">Session (room id)</span>
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              className="mt-1 w-full bg-ink border border-edge rounded px-3 py-2 text-bone"
            />
          </label>

          <label className="block text-sm">
            <span className="text-muted">Google Meet link</span>
            <input
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              placeholder="https://meet.google.com/abc-defg-hij"
              className="mt-1 w-full bg-ink border border-edge rounded px-3 py-2 text-bone"
            />
          </label>

          <div className="flex gap-3 pt-1">
            <button
              onClick={sendBot}
              disabled={!meetingUrl || !room}
              className="px-4 py-2 rounded bg-amber text-ink font-medium disabled:opacity-40"
            >
              Send bot
            </button>
            <button
              onClick={stopBot}
              disabled={!botId}
              className="px-4 py-2 rounded border border-edge text-bone disabled:opacity-40"
            >
              Stop bot
            </button>
            <button
              onClick={connectWs}
              className="px-4 py-2 rounded border border-edge text-muted"
            >
              Reconnect socket
            </button>
          </div>

          <div className="text-xs text-muted pt-1">
            status: <span className="text-bone">{status}</span> · socket:{" "}
            <span
              className={
                wsState === "connected" ? "text-sage" : "text-amber"
              }
            >
              {wsState}
            </span>
          </div>
        </div>

        <div className="bg-panel border border-edge rounded-lg p-4">
          <div className="text-sm text-muted mb-2">
            Live transcript ({lines.length})
          </div>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {lines.length === 0 ? (
              <div className="text-muted text-sm">
                Nothing yet. Once the bot joins and someone speaks, utterances
                appear here.
              </div>
            ) : (
              lines.map((l, i) => (
                <div key={i} className="text-sm">
                  <span
                    className={
                      l.role === "host" ? "text-amber" : "text-sage"
                    }
                  >
                    {l.speaker || l.role || "?"}
                  </span>
                  <span className="text-bone">: {l.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
