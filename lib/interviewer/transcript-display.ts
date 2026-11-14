export type SpokenLine = {
  id: string;
  speaker: "agent" | "lead";
  text: string;
};

function unfinished(text: string): boolean {
  return !/[.!?]$/.test(text.trim());
}

function joinFragments(left: string, right: string): string {
  const start = left.trim();
  const next = right.trim();
  if (!start) return next;
  if (!next) return start;
  if (start.endsWith("-")) return `${start.slice(0, -1)}${next}`;
  return `${start} ${next}`;
}

// Newest line first. Adjacent words from the same person are one line, including
// a lead sentence the agent interrupted in the middle.
export function presentTranscript(lines: SpokenLine[]): SpokenLine[] {
  const merged: SpokenLine[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.speaker === line.speaker) {
      previous.text = joinFragments(previous.text, text);
      continue;
    }
    if (line.speaker === "lead" && merged.length >= 2) {
      const between = merged[merged.length - 1];
      const earlier = merged[merged.length - 2];
      if (between.speaker === "agent" && earlier.speaker === "lead" && unfinished(earlier.text)) {
        earlier.text = joinFragments(earlier.text, text);
        continue;
      }
    }
    merged.push({ id: line.id, speaker: line.speaker, text });
  }
  return merged.reverse();
}
