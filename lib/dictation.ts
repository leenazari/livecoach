// Shared dictation transcript merge for browser speech recognition.
//
// Speech recognition behaves two different ways, and naive concatenation breaks
// on mobile:
//   - Desktop Chrome returns a fresh SEGMENT per result -> they should append.
//   - Android Chrome RESTATES the whole phrase so far in each result (and across
//     events), so appending stacks the growing prefixes and you get the runaway
//     "sosososo theso the day..." duplication.
//
// mergeTranscript REPLACES when a new chunk restates what we already have (and
// drops shorter restatements / exact tail repeats), and only appends genuinely
// new segments. foldDictationEvent rebuilds the finals from a result list,
// carries them across events (Android resets its result list), and returns the
// live text to show (committed finals + the latest interim), normalised to
// single spaces. Used by every dictation box so the fix lives in one place.

export function mergeTranscript(acc: string, seg: string): string {
  const a = (acc || "").trim();
  const s = (seg || "").trim();
  if (!a) return seg || "";
  if (!s) return acc;
  const la = a.toLowerCase();
  const ls = s.toLowerCase();
  if (ls.startsWith(la)) return seg; // chunk extends everything so far
  if (la.startsWith(ls)) return acc; // chunk is a shorter restatement
  if (la.endsWith(ls)) return acc; // chunk already sits at the tail
  const needsSpace = !acc.endsWith(" ") && !(seg || "").startsWith(" ");
  return acc + (needsSpace ? " " : "") + seg;
}

// Given the prior committed finals and a SpeechRecognition result list, return
// the new committed finals and the full live text (committed + latest interim).
export function foldDictationEvent(
  committed: string,
  results: any
): { committed: string; text: string } {
  let finals = "";
  let interim = "";
  const n = results?.length || 0;
  for (let i = 0; i < n; i++) {
    const seg = results[i]?.[0]?.transcript || "";
    if (results[i]?.isFinal) finals = mergeTranscript(finals, seg);
    else interim = seg;
  }
  const nextCommitted = mergeTranscript(committed, finals);
  const text = mergeTranscript(nextCommitted, interim)
    .replace(/\s+/g, " ")
    .trim();
  return { committed: nextCommitted, text };
}
