export type SpeakerTurn = {
  index: number;
  speaker: string;
  text: string;
};

const SPEAKER_LINE = /^\s*([A-Za-z][A-Za-z0-9 .'’\-]{0,79}):\s?(.*)$/;
const GENERIC_HOST_LABELS = new Set(["you", "interviewer", "host", "me"]);
const SPEAKER_PREFIX = /^(?:team member|meeting participant|participant|speaker|attendee)\s+/;
const SIGNAL_TERMS = [
  "pilot",
  "price",
  "pricing",
  "budget",
  "decision",
  "approve",
  "approval",
  "timeline",
  "next step",
  "follow up",
  "competitor",
  "currently use",
  "volume",
  "saving",
  "cost",
  "risk",
  "problem",
  "pain",
  "need",
  "trial",
  "test account",
  "recording",
  "stakeholder",
  "founder",
  "contract",
  "procurement",
  "success",
];

export function normaliseCoachingText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseSpeakerLabel(value: unknown) {
  return normaliseCoachingText(value).replace(SPEAKER_PREFIX, "").trim();
}

function personAliases(fullName: string) {
  const name = normaliseCoachingText(fullName);
  const aliases = new Set<string>();
  if (!name) return aliases;
  aliases.add(name);
  const parts = name.split(" ").filter(Boolean);
  if (parts.length > 1) {
    const initials = parts.map((part) => part[0]).join("");
    aliases.add(initials);
    aliases.add(initials.split("").join(" "));
  }
  for (const part of parts) if (part.length >= 3) aliases.add(part);
  return aliases;
}

export function speakerMatchesPerson(
  label: string,
  fullName: string,
  allowGenericHostLabels = true
) {
  const speaker = normaliseSpeakerLabel(label);
  if (!speaker) return false;
  if (GENERIC_HOST_LABELS.has(speaker)) return allowGenericHostLabels;
  if (personAliases(fullName).has(speaker)) return true;
  const knownParts = normaliseCoachingText(fullName).split(" ").filter(Boolean);
  return (
    knownParts.length === 1 &&
    knownParts[0].length >= 3 &&
    speaker.split(" ").includes(knownParts[0])
  );
}

export function parseSpeakerTurns(transcript: string): SpeakerTurn[] {
  const turns: SpeakerTurn[] = [];
  for (const rawLine of String(transcript || "").split(/\r?\n/)) {
    const match = rawLine.match(SPEAKER_LINE);
    if (match) {
      turns.push({
        index: turns.length,
        speaker: match[1].trim(),
        text: String(match[2] || "").trim(),
      });
      continue;
    }
    if (!turns.length || !rawLine.trim()) continue;
    turns[turns.length - 1].text = `${turns[turns.length - 1].text} ${rawLine.trim()}`.trim();
  }
  return turns;
}

export function hostSpeakingStats(
  transcript: string,
  hostName: string,
  allowGenericHostLabels = true
) {
  const hostTurns = parseSpeakerTurns(transcript).filter((turn) =>
    speakerMatchesPerson(turn.speaker, hostName, allowGenericHostLabels)
  );
  return {
    turns: hostTurns.length,
    words: hostTurns.reduce(
      (sum, turn) => sum + normaliseCoachingText(turn.text).split(" ").filter(Boolean).length,
      0
    ),
  };
}

export function otherSpeakerNames(
  transcript: string,
  hostName: string,
  allowGenericHostLabels = true
) {
  const names = new Map<string, string>();
  for (const turn of parseSpeakerTurns(transcript)) {
    if (speakerMatchesPerson(turn.speaker, hostName, allowGenericHostLabels))
      continue;
    const normalised = normaliseSpeakerLabel(turn.speaker);
    if (!normalised || GENERIC_HOST_LABELS.has(normalised)) continue;
    if (!names.has(normalised)) names.set(normalised, turn.speaker.trim());
  }
  return [...names.values()].slice(0, 12);
}

function signalScore(value: string) {
  const text = normaliseCoachingText(value);
  return SIGNAL_TERMS.reduce(
    (score, term) => score + (text.includes(normaliseCoachingText(term)) ? 1 : 0),
    0
  );
}

function excerpt(value: string, limit: number) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const lower = text.toLowerCase();
  const positions = SIGNAL_TERMS.map((term) => lower.indexOf(term)).filter(
    (position) => position >= 0
  );
  const focus = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, Math.min(focus - Math.floor(limit / 3), text.length - limit));
  const end = Math.min(text.length, start + limit);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${
    end < text.length ? "…" : ""
  }`;
}

// A long call should not be coached from only its final few minutes. Select
// commercially significant host moments plus an even sample from the full
// conversation, retaining the adjacent response so every quote stays grounded.
export function buildStrategicCoachingTranscript(
  transcript: string,
  hostName: string,
  maxChars = 30000,
  allowGenericHostLabels = true
) {
  const turns = parseSpeakerTurns(transcript);
  const hostTurnIndexes = turns
    .filter((turn) =>
      speakerMatchesPerson(turn.speaker, hostName, allowGenericHostLabels)
    )
    .map((turn) => turn.index);
  if (!hostTurnIndexes.length) return "";

  const scored = hostTurnIndexes
    .map((index) => ({
      index,
      score: signalScore(
        [turns[index - 1]?.text, turns[index]?.text, turns[index + 1]?.text]
          .filter(Boolean)
          .join(" ")
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = new Set<number>();
  for (const item of scored.slice(0, 14)) selected.add(item.index);
  const EVEN_SAMPLE = 14;
  for (let i = 0; i < EVEN_SAMPLE; i += 1) {
    const at = Math.round((i * (hostTurnIndexes.length - 1)) / Math.max(1, EVEN_SAMPLE - 1));
    selected.add(hostTurnIndexes[at]);
  }

  const blocks = [...selected]
    .sort((a, b) => a - b)
    .map((index) => {
      const rows = [
        turns[index - 1]
          ? `${turns[index - 1].speaker}: ${excerpt(turns[index - 1].text, 320)}`
          : "",
        `${turns[index].speaker}: ${excerpt(turns[index].text, 760)}`,
        turns[index + 1]
          ? `${turns[index + 1].speaker}: ${excerpt(turns[index + 1].text, 420)}`
          : "",
      ].filter(Boolean);
      return `[Call moment ${index + 1}]\n${rows.join("\n")}`;
    });

  const kept: string[] = [];
  let used = 0;
  for (const block of blocks) {
    if (used + block.length + 2 > maxChars) continue;
    kept.push(block);
    used += block.length + 2;
  }
  return kept.join("\n\n");
}

// The model may occasionally paraphrase or quote another participant. Keep a
// coaching point only when its quote is verifiably the selected user's words.
export function keepGroundedHostQuotes(
  points: any[],
  transcript: string,
  hostName: string,
  allowGenericHostLabels = true
) {
  const turns = parseSpeakerTurns(transcript);
  const host = normaliseCoachingText(
    turns
      .filter((turn) =>
        speakerMatchesPerson(turn.speaker, hostName, allowGenericHostLabels)
      )
      .map((turn) => turn.text)
      .join(" ")
  );
  return (Array.isArray(points) ? points : []).filter((point: any) => {
    const quote = normaliseCoachingText(point?.quote);
    return !quote || (!!host && host.includes(quote));
  });
}
