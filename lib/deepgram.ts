// ============================================================
// Deepgram client-side helpers.
//
// The real Deepgram API key NEVER reaches the browser. Instead, the browser
// asks our own server route (/api/deepgram-token) for a short-lived access
// token and connects to Deepgram with that. The token is a JWT with a ~60s
// TTL and usage:write only, so a leaked token is near-worthless.
//
// Model + listen params live here as the single source of truth, so the
// transcription model can be changed in ONE place.
// ============================================================

// Fetch a fresh short-lived Deepgram access token from our server.
// Call this immediately before opening EACH socket (including reconnects) —
// tokens are short-lived by design, so a token fetched once at call-start
// will be expired by the time a mid-call reconnect fires.
export async function getDeepgramToken(): Promise<string> {
  const res = await fetch("/api/deepgram-token", { method: "POST" });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Deepgram token request failed (${res.status})${detail ? `: ${detail}` : ""}`
    );
  }
  const data = await res.json();
  if (!data?.access_token) {
    throw new Error("Deepgram token response missing access_token");
  }
  return data.access_token as string;
}

// Single source of truth for the live-transcription URL + model params.
// Change the model here and it changes everywhere (CallStage, InterviewConsole,
// VoiceNoteButton).
export function deepgramListenUrl(): string {
  const params = new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    punctuate: "true",
    interim_results: "true",
    endpointing: "300",
    language: "en",
  });
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}
