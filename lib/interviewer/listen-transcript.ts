// Deepgram's streaming listen API sends the same words more than once.
// An interim result is later repeated as is_final, and that is_final segment
// is often repeated again when speech_final is true. CallStage and
// InterviewConsole append every is_final transcript, so those words show up
// twice. lib/deepgram.ts also leaves interim_results on and does not force a
// single channel. This folder handles that itself and does not change those files.

export type ListenFrame = {
  transcript: string;
  isFinal: boolean;
  speechFinal: boolean;
  start: number | null;
};

export type LockedUtterance = {
  id: string;
  text: string;
  start: number | null;
};

export type ListenDecision = {
  interim: string;
  lock: LockedUtterance | null;
  revise: LockedUtterance | null;
};

type OpenSegment = LockedUtterance;

export function normalizeTranscript(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function utteranceKey(speaker: "agent" | "lead", start: number | null, text: string): string {
  const words = normalizeTranscript(text);
  let hash = 0;
  for (let index = 0; index < words.length; index += 1) {
    hash = (hash * 33 + words.charCodeAt(index)) >>> 0;
  }
  const at = start == null || !Number.isFinite(start) ? "x" : start.toFixed(2);
  return `${speaker}:${at}:${hash.toString(36)}`.slice(0, 80);
}

export function sameSpokenWords(left: string, right: string): boolean {
  const a = normalizeTranscript(left);
  const b = normalizeTranscript(right);
  return a.length > 0 && a === b;
}

export function createListenFold() {
  let interim = "";
  let open: OpenSegment | null = null;

  const segment = (text: string, start: number | null): OpenSegment => ({
    id: utteranceKey("lead", start, text),
    text,
    start,
  });

  return {
    push(frame: ListenFrame): ListenDecision {
      const text = frame.transcript.trim();
      if (!text) return { interim, lock: null, revise: null };
      if (!frame.isFinal) {
        interim = text;
        return { interim, lock: null, revise: null };
      }

      interim = "";
      const next = segment(text, frame.start);
      const repeatsOpen = open != null && (
        sameSpokenWords(open.text, text)
        || (frame.start != null && open.start != null && Math.abs(frame.start - open.start) < 0.05)
      );

      if (!frame.speechFinal) {
        if (repeatsOpen && open) {
          open = { ...open, text };
          return { interim, lock: null, revise: open };
        }
        const previous = open;
        open = next;
        return { interim, lock: previous, revise: open };
      }

      if (repeatsOpen && open) {
        const locked = { ...open, text };
        open = null;
        return { interim, lock: locked, revise: null };
      }
      const previous = open;
      open = null;
      return { interim, lock: previous, revise: next };
    },
    flush(): LockedUtterance | null {
      interim = "";
      const locked = open;
      open = null;
      return locked;
    },
  };
}

export function isDuplicateUtterance(
  existing: Array<{ speaker: string; text: string; ts: string }>,
  incoming: { speaker: string; text: string; ts: string },
  windowMs = 2000
): boolean {
  const text = normalizeTranscript(incoming.text);
  const at = Date.parse(incoming.ts);
  if (!text) return true;
  return existing.some((row) => {
    if (row.speaker !== incoming.speaker) return false;
    if (normalizeTranscript(row.text) !== text) return false;
    const delta = Math.abs(Date.parse(row.ts) - at);
    return Number.isFinite(delta) && delta <= windowMs;
  });
}

export function looksLikeSpeakerEcho(leadText: string, recentAgentText: string[]): boolean {
  const lead = normalizeTranscript(leadText);
  if (lead.length < 12) return false;
  return recentAgentText.some((agent) => {
    const spoken = normalizeTranscript(agent);
    if (spoken.length < 12) return false;
    return spoken.includes(lead) || lead.includes(spoken);
  });
}

export function agentTurnExtends(previous: string, next: string): boolean {
  const prior = normalizeTranscript(previous);
  const incoming = normalizeTranscript(next);
  if (!prior || !incoming) return false;
  return incoming.startsWith(prior) || prior.startsWith(incoming);
}
