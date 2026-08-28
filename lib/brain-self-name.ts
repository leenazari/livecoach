export type BrainSelfIdentity = {
  canonicalName: string;
  aliases?: string[];
};

export type BrainKnownIdentity = BrainSelfIdentity & {
  relationship: "signed_in_user" | "workspace_owner";
};

export type BrainSelfNameResolution = {
  resolvedMessage: string;
  matchedPhrases: string[];
  canonicalName: string;
};

export type BrainKnownNameResolution = {
  resolvedMessage: string;
  matches: Array<{
    heard: string;
    canonicalName: string;
    relationship: BrainKnownIdentity["relationship"];
  }>;
};

type Word = {
  value: string;
  start: number;
  end: number;
};

const LOOKUP_LANGUAGE =
  /\b(search|find|look(?:ed|ing)?\s+up|lookup|show|call|called|contact|communicate|speak|talk|meeting|appointment|invite|invited|attendee|email|calendar|schedule|transcript|what\s+(?:did|has|is)|when\s+did|where\s+is|who\s+is|for|about)\b/i;

const NON_NAME_WORDS = new Set([
  "about",
  "calendar",
  "call",
  "called",
  "email",
  "find",
  "for",
  "from",
  "has",
  "have",
  "is",
  "look",
  "lookup",
  "meeting",
  "my",
  "search",
  "show",
  "the",
  "what",
  "when",
  "where",
  "who",
  "with",
]);

export function normaliseBrainName(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsWithOffsets(message: string): Word[] {
  const words: Word[] = [];
  const pattern = /[\p{L}\p{N}]+/gu;
  for (const match of message.matchAll(pattern)) {
    const start = match.index ?? 0;
    words.push({
      value: normaliseBrainName(match[0]),
      start,
      end: start + match[0].length,
    });
  }
  return words.filter((word) => !!word.value);
}

function compact(value: string): string {
  return normaliseBrainName(value).replace(/\s/g, "");
}

function consonantSignature(value: string): string {
  return compact(value).replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1");
}

function highConfidenceSpokenMatch(candidate: string, canonical: string): boolean {
  const candidateCompact = compact(candidate);
  const canonicalCompact = compact(canonical);
  if (
    candidateCompact.length < 5 ||
    canonicalCompact.length < 5 ||
    candidateCompact[0] !== canonicalCompact[0] ||
    Math.abs(candidateCompact.length - canonicalCompact.length) > 2
  ) {
    return false;
  }
  const signature = consonantSignature(canonical);
  return signature.length >= 3 && consonantSignature(candidate) === signature;
}

function exactAliasMatch(candidate: string, aliases: string[]): boolean {
  const normal = normaliseBrainName(candidate);
  return aliases.some((alias) => normaliseBrainName(alias) === normal);
}

/**
 * Resolve a high-confidence speech-to-text rendering of one known account
 * identity. This deliberately does not fuzzy-match a first name. It also lets
 * exact visible CRM contacts win, preventing a real person from being silently
 * replaced with the signed-in user or workspace owner.
 */
export function resolveBrainSelfName(
  message: string,
  identity: BrainSelfIdentity,
  protectedNames: string[] = []
): BrainSelfNameResolution {
  const canonicalName = String(identity.canonicalName || "")
    .replace(/\s+/g, " ")
    .trim();
  const canonicalWords = normaliseBrainName(canonicalName)
    .split(" ")
    .filter(Boolean);
  if (!message || canonicalWords.length < 2) {
    return { resolvedMessage: message, matchedPhrases: [], canonicalName };
  }

  const aliases = Array.from(
    new Set(
      [canonicalName, ...(identity.aliases || [])]
        .map((alias) => String(alias || "").replace(/\s+/g, " ").trim())
        .filter((alias) => normaliseBrainName(alias).split(" ").length >= 2)
    )
  );
  const protectedSet = new Set(protectedNames.map(normaliseBrainName));
  const words = wordsWithOffsets(message);
  const replacements: Array<{ start: number; end: number; phrase: string }> = [];

  for (let index = 0; index <= words.length - canonicalWords.length; index += 1) {
    const window = words.slice(index, index + canonicalWords.length);
    const phrase = message.slice(window[0].start, window[window.length - 1].end);
    const normalPhrase = normaliseBrainName(phrase);
    if (!normalPhrase || normalPhrase === normaliseBrainName(canonicalName)) continue;
    if (protectedSet.has(normalPhrase)) continue;
    if (window.some((word) => NON_NAME_WORDS.has(word.value))) continue;

    const configuredAlias = exactAliasMatch(phrase, aliases);
    const phoneticAlias =
      LOOKUP_LANGUAGE.test(message) &&
      highConfidenceSpokenMatch(phrase, canonicalName);
    if (!configuredAlias && !phoneticAlias) continue;
    replacements.push({
      start: window[0].start,
      end: window[window.length - 1].end,
      phrase,
    });
  }

  if (!replacements.length) {
    return { resolvedMessage: message, matchedPhrases: [], canonicalName };
  }

  let resolvedMessage = message;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    resolvedMessage =
      resolvedMessage.slice(0, replacement.start) +
      canonicalName +
      resolvedMessage.slice(replacement.end);
  }
  return {
    resolvedMessage,
    matchedPhrases: replacements
      .sort((a, b) => a.start - b.start)
      .map((replacement) => replacement.phrase),
    canonicalName,
  };
}

export function resolveBrainKnownNames(
  message: string,
  identities: BrainKnownIdentity[],
  protectedNames: string[] = []
): BrainKnownNameResolution {
  let resolvedMessage = message;
  const matches: BrainKnownNameResolution["matches"] = [];
  const usedNames = new Set<string>();

  for (const identity of identities) {
    const identityKey = normaliseBrainName(identity.canonicalName);
    if (!identityKey || usedNames.has(identityKey)) continue;
    usedNames.add(identityKey);
    const resolution = resolveBrainSelfName(
      resolvedMessage,
      identity,
      protectedNames
    );
    resolvedMessage = resolution.resolvedMessage;
    for (const heard of resolution.matchedPhrases) {
      matches.push({
        heard,
        canonicalName: resolution.canonicalName,
        relationship: identity.relationship,
      });
    }
  }

  return { resolvedMessage, matches };
}
