const SIGNATURE_STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "record", "call", "note",
  "correct", "remember", "add", "focus", "update", "client", "profile", "set",
  "link", "them", "their", "from", "into", "have", "has", "been", "also",
  "just", "now", "who", "his", "her", "one", "two", "day", "take", "over",
  "around", "still", "worth", "new",
]);

const normalise = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const words = (value: unknown): string[] =>
  Array.from(
    new Set(
      normalise(value)
        .split(" ")
        .filter(
          (word) => word.length >= 4 && !SIGNATURE_STOP_WORDS.has(word)
        )
    )
  );

const target = (action: any): string => {
  const endpoint = String(action?.endpoint || "");
  let match = endpoint.match(/\/companies\/([^/]+)/);
  if (match) return match[1];
  match = endpoint.match(/\/upcoming\/([^/]+)/);
  if (match) return match[1];
  match = endpoint.match(/\/(?:contacts|opportunities|tasks|campaigns)\/([^/]+)/);
  if (match) return match[1];
  const body = action?.body || {};
  return normalise(
    body.title || body.name || body.email || body.query || body.client || ""
  );
};

export type BrainActionSignature = {
  type: string;
  target: string;
  words: string[];
  outcome?: "completed" | "not_completed";
};

export function brainActionSignature(action: any): BrainActionSignature {
  return {
    type: String(action?.type || ""),
    target: target(action),
    words: words(action?.label),
  };
}

function overlap(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  let matches = 0;
  for (const word of left) if (rightSet.has(word)) matches += 1;
  return matches / Math.min(left.length, right.length);
}

export function sameBrainAction(
  left: Partial<BrainActionSignature>,
  right: Partial<BrainActionSignature>
): boolean {
  if (!left?.type || left.type !== right?.type) return false;
  const wordOverlap = overlap(
    Array.isArray(left.words) ? left.words : [],
    Array.isArray(right.words) ? right.words : []
  );
  if (left.target && right.target && left.target === right.target)
    return wordOverlap >= 0.34;
  if (!left.target && !right.target) return wordOverlap >= 0.5;
  return wordOverlap >= 0.7;
}

export function actionWasAlreadyProposed(
  action: any,
  prior: BrainActionSignature[]
): boolean {
  const signature = brainActionSignature(action);
  return prior.some((item) => sameBrainAction(signature, item));
}
