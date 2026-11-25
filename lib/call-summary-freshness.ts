import { createHash } from "node:crypto";

type SavedSummary = {
  summary?: any;
  created_at?: string | null;
};
type CapturedSession = {
  session_id?: string | null;
  transcript?: string | null;
  ended_at?: string | null;
};

// A fingerprint of the existing source, never a second copy of the transcript.
export function callTranscriptHash(transcript: string): string {
  return createHash("sha256").update(transcript).digest("hex");
}

// JSONB may return object keys in a different order from the model response.
// Hash content consistently so a corrected recap invalidates derived context,
// while the same recap does not trigger another assessment.
export function callSummaryContentHash(summary: unknown): string {
  const ordered = (value: any): any => Array.isArray(value)
    ? value.map(ordered)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]))
      : value;
  return createHash("sha256").update(JSON.stringify(ordered(summary ?? null))).digest("hex");
}

export function callSummaryIsCurrent(
  saved: SavedSummary | null | undefined,
  session: CapturedSession | null | undefined,
): boolean {
  if (!saved?.summary || !session) return false;
  const evidence = saved.summary.sourceEvidence;
  if (evidence?.version === 1 && evidence.transcriptHash) {
    if (evidence.sessionId !== session.session_id) return false;
    // Unattended captures can live only in meet_utterances. Their source hash
    // is checked by the summary job when it loads the canonical capture.
    if (session.transcript) {
      return evidence.transcriptHash === callTranscriptHash(session.transcript);
    }
  }
  // Compatibility for older summaries without a fingerprint. Do not pay to
  // regenerate unchanged historical calls, but never reuse a recap which
  // predates the end of a later/rescheduled conversation. Allow only small
  // end-call write ordering differences, not another call days later.
  const generated = Date.parse(evidence?.generatedAt || saved.created_at || "");
  const ended = Date.parse(session.ended_at || "");
  return Number.isFinite(generated) &&
    (!Number.isFinite(ended) || generated >= ended - 120_000);
}

export function summarySourceEvidence(sessionId: string | null, transcript: string) {
  return { version: 1, sessionId, transcriptHash: callTranscriptHash(transcript), generatedAt: new Date().toISOString() };
}

// The old recap is retained privately for traceability but never fed back into
// the new assessment or its current action pack. No raw transcript is copied.
export function revisedSummaryPackage(previous: any) {
  const pack = previous.post_call_package || {};
  const { summaryRevisions, ...previousPackage } = pack;
  return {
    summaryRevisions: [...(Array.isArray(summaryRevisions) ? summaryRevisions : []), {
      archivedAt: new Date().toISOString(),
      createdAt: previous.created_at,
      cacheKey: previous.cache_key,
      summary: previous.summary,
      package: previousPackage,
      reason: "The saved transcript changed after this recap was generated",
    }],
  };
}
