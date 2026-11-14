import { deepgramListenUrl } from "@/lib/deepgram";

// Same listen socket as CallStage: short-lived bearer token, nova-3 URL from
// lib/deepgram.ts, final transcripts only. The token is minted by the
// interviewer route after a slot is claimed, not by /api/deepgram-token,
// because this page has no workspace session.
export function startLeadListener(input: {
  stream: MediaStream;
  token: string;
  onTranscript: (text: string) => void;
  onRefusal: (detail: { closeCode?: number; message?: string }) => void;
}): () => void {
  let closed = false;
  let recorder: MediaRecorder | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const socket = new WebSocket(deepgramListenUrl(), ["bearer", input.token]);

  const stop = () => {
    closed = true;
    if (keepAlive) clearInterval(keepAlive);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  };

  socket.onopen = () => {
    if (closed) return;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined;
    recorder = mimeType ? new MediaRecorder(input.stream, { mimeType }) : new MediaRecorder(input.stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) socket.send(event.data);
    };
    recorder.start(150);
    keepAlive = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "KeepAlive" }));
    }, 3000);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(String(event.data));
      const text = String(data?.channel?.alternatives?.[0]?.transcript || "").trim();
      if (text && data.is_final) input.onTranscript(text);
    } catch {
      // Keepalive replies are not transcripts.
    }
  };

  socket.onerror = () => {
    if (!closed) input.onRefusal({ message: "listen socket error" });
  };

  socket.onclose = (event) => {
    if (!closed) input.onRefusal({ closeCode: event.code, message: event.reason });
  };

  return stop;
}
