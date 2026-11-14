import { interviewerListenUrl } from "@/lib/interviewer/listen-url";
import { createListenFold, type ListenDecision } from "@/lib/interviewer/listen-transcript";

export type LeadListenHandlers = {
  onDecision: (decision: ListenDecision) => void;
  onRefusal: (detail: { closeCode?: number; message?: string }) => void;
  onOverlap?: () => void;
};

// A second call closes the previous socket. React strict mode and a repeated
// connect would otherwise leave two listeners on the same microphone.
let activeStop: (() => void) | null = null;

export function startLeadListener(input: {
  stream: MediaStream;
  token: string;
  handlers: LeadListenHandlers;
}): () => void {
  activeStop?.();

  const tracks = input.stream.getAudioTracks().slice(0, 1);
  const micOnly = new MediaStream(tracks);
  let stopped = false;
  let recorder: MediaRecorder | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const fold = createListenFold();
  const socket = new WebSocket(interviewerListenUrl(), ["bearer", input.token]);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (activeStop === stop) activeStop = null;
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* already stopping */ }
    }
    recorder = null;
    if (socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: "CloseStream" })); } catch { /* ignore */ }
    }
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
    const tail = fold.flush();
    if (tail) input.handlers.onDecision({ interim: "", lock: tail, revise: null });
  };

  activeStop = stop;

  socket.onopen = () => {
    if (stopped) {
      socket.close();
      return;
    }
    if (recorder) return;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    recorder = new MediaRecorder(micOnly, { mimeType });
    recorder.ondataavailable = (event) => {
      if (stopped) return;
      if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) socket.send(event.data);
    };
    recorder.start(250);
    keepAlive = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "KeepAlive" }));
    }, 3000);
  };

  socket.onmessage = (event) => {
    if (stopped || typeof event.data !== "string") return;
    try {
      const data = JSON.parse(event.data);
      const alternative = data?.channel?.alternatives?.[0];
      const words = Array.isArray(alternative?.words) ? alternative.words : [];
      const speakers = new Set(words.map((word: { speaker?: number }) => word?.speaker).filter((speaker: number | undefined) => speaker != null));
      if (speakers.size > 1) input.handlers.onOverlap?.();
      const transcript = String(alternative?.transcript || "");
      if (!transcript.trim()) return;
      input.handlers.onDecision(fold.push({
        transcript,
        isFinal: data.is_final === true,
        speechFinal: data.speech_final === true,
        start: Number.isFinite(Number(data.start)) ? Number(data.start) : null,
      }));
    } catch {
      // Keepalive replies are not transcripts.
    }
  };

  socket.onerror = () => {
    if (!stopped) input.handlers.onRefusal({ message: "listen socket error" });
  };

  socket.onclose = (event) => {
    if (!stopped) input.handlers.onRefusal({ closeCode: event.code, message: event.reason });
  };

  return stop;
}
