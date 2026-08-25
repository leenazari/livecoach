export type TranscriptDownloadId =
  | { kind: "summary"; id: string }
  | { kind: "session"; id: string };

export type TranscriptDownloadMetadata = {
  title: string;
  company: string | null;
  recordedAt: string | null;
  participants: string[];
  transcript: string;
};

const SAFE_ID = /^[A-Za-z0-9._:-]{1,240}$/;

export function parseTranscriptDownloadId(value: string): TranscriptDownloadId | null {
  const input = String(value || "").trim();
  if (!input || !SAFE_ID.test(input)) return null;
  if (input.startsWith("session:")) {
    const id = input.slice("session:".length);
    return id && SAFE_ID.test(id) ? { kind: "session", id } : null;
  }
  return { kind: "summary", id: input };
}

const safeStem = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .toLowerCase() || "call";

export function transcriptDownloadFilename(
  title: string,
  recordedAt: string | null
): string {
  const parsed = recordedAt ? new Date(recordedAt) : null;
  const date = parsed && Number.isFinite(parsed.getTime())
    ? parsed.toISOString().slice(0, 10)
    : "undated";
  return `${safeStem(title)}-${date}-transcript.txt`;
}

const londonDate = (value: string | null) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  return date.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  });
};

export function renderTranscriptDownload(metadata: TranscriptDownloadMetadata): string {
  const sections = [
    "LiveCoach call transcript",
    "",
    "Call",
    metadata.title || "Call",
    "",
    "Client",
    metadata.company || "Not linked",
    "",
    "Recorded",
    londonDate(metadata.recordedAt),
  ];
  if (metadata.participants.length) {
    sections.push("", "Speakers", metadata.participants.join(", "));
  }
  sections.push("", "Transcript", "", metadata.transcript);
  return sections.join("\n");
}
