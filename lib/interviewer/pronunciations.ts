import { SPEECH_WORDS } from "./speech-words";

const ACRONYMS = new Set([
  "POS", "EPOS", "KDS", "AI", "SMS", "QR", "UK", "US", "EU", "TV", "ID", "OK",
  "FAQ", "API", "URL", "PDF", "CRM", "VAT", "GBP", "USD", "EUR", "CEO", "ROI", "CTA",
  "SEO", "AEO",
]);

const LIVE_PHRASES: Array<[RegExp, string]> = [
  [/\bsee it live\b/gi, "see it in real time"],
  [/\bwatch it live\b/gi, "watch it in real time"],
  [/\bgoes live\b/gi, "is up and running"],
  [/\bgoing live\b/gi, "getting up and running"],
  [/\bgo live\b/gi, "go up and running"],
  [/\bwent live\b/gi, "was up and running"],
  [/\blive demo\b/gi, "real-time demo"],
  [/\blive chat\b/gi, "real-time chat"],
  [/\blive call\b/gi, "real-time call"],
  [/\blive system\b/gi, "working system"],
];

const LEAD_PHRASES: Array<[RegExp, string]> = [
  [/\blead generation\b/gi, "finding new customers"],
  [/\bqualified leads\b/gi, "qualified enquiries"],
  [/\bqualified lead\b/gi, "qualified enquiry"],
  [/\bcapture leads\b/gi, "capture enquiries"],
  [/\bnew leads\b/gi, "new enquiries"],
  [/\bmore leads\b/gi, "more enquiries"],
  [/\bsales leads\b/gi, "enquiries"],
  [/\bsales lead\b/gi, "enquiry"],
];

const VERB_NEXT = /^(in|at|on|near|with|for|here|there|alone|together)\b/i;

export function normaliseBrandCaps(text: string): string {
  return text.replace(/\b[A-Z]{3,}\b/g, (word) => (
    ACRONYMS.has(word) ? word : word.charAt(0) + word.slice(1).toLowerCase()
  ));
}

export function rewriteLive(text: string): string {
  let next = text;
  for (const [pattern, replacement] of LIVE_PHRASES) next = next.replace(pattern, replacement);
  return next.replace(/\blive\s+([A-Za-z][A-Za-z-]*)/gi, (match, noun: string) => (
    VERB_NEXT.test(noun) ? match : `real-time ${noun}`
  ));
}

export function rewriteSalesLead(text: string): string {
  let next = text;
  for (const [pattern, replacement] of LEAD_PHRASES) next = next.replace(pattern, replacement);
  next = next.replace(/\bleads\b(?!\s+(?:to|the|with|by|on|into)\b)/gi, "enquiries");
  return next.replace(/\blead\b(?!\s+(?:the|to|with|by|on|into|time)\b)/gi, (match, offset: number, whole: string) => {
    const before = whole.slice(Math.max(0, offset - 4), offset);
    return /\bto\s$/i.test(before) ? match : "enquiry";
  });
}

export function forPrompt(text: string): string {
  return normaliseBrandCaps(String(text || ""));
}

const SHORT_WORD = new Set(["a", "an", "and", "are", "as", "at", "be", "do", "for", "how", "in", "is", "it", "of", "on", "or", "the", "to", "we", "you"]);

function openToken(token: string): string {
  if (SPEECH_WORDS.has(token.toLowerCase())) return token;
  if (/[a-z][A-Z]/.test(token)) return token.replace(/([a-z])([A-Z])/g, "$1 $2");
  if (token.length < 18) return token;
  return safeSplit(token) || token;
}

// Split a long run of words only when every piece is a real word. A normal
// word such as "environment" or "hear" is left whole.
function safeSplit(token: string): string | null {
  const lower = token.toLowerCase();
  const cost = new Array<number>(lower.length + 1).fill(Number.POSITIVE_INFINITY);
  const prev = new Array<number>(lower.length + 1).fill(-1);
  const long = new Array<number>(lower.length + 1).fill(0);
  cost[0] = 0;
  for (let start = 0; start < lower.length; start += 1) {
    if (!Number.isFinite(cost[start])) continue;
    const max = Math.min(22, lower.length - start);
    for (let length = max; length >= 1; length -= 1) {
      const slice = lower.slice(start, start + length);
      const allowed = length >= 4 ? SPEECH_WORDS.has(slice) : SHORT_WORD.has(slice);
      if (!allowed) continue;
      const next = start + length;
      const nextCost = cost[start] + 1;
      const nextLong = long[start] + (length >= 4 ? 1 : 0);
      if (nextCost < cost[next] || (nextCost === cost[next] && nextLong > long[next])) {
        cost[next] = nextCost;
        prev[next] = start;
        long[next] = nextLong;
      }
    }
  }
  if (!Number.isFinite(cost[lower.length]) || long[lower.length] < 2) return null;
  const parts: string[] = [];
  for (let cursor = lower.length; cursor > 0; cursor = prev[cursor]) {
    const start = prev[cursor];
    if (start < 0) return null;
    parts.push(lower.slice(start, cursor));
  }
  parts.reverse();
  const phrase = parts.join(" ");
  return token[0] === token[0].toUpperCase() ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase;
}

export function restoreSpokenGaps(text: string): string {
  const original = String(text || "");
  let next = original;
  next = next.replace(/([.!?])([A-Za-z])/g, "$1 $2");
  next = next.replace(/([,;:])([A-Za-z])/g, "$1 $2");
  next = next.replace(/([A-Za-z]+'(?:ll|re|ve|d|m|s|t))([A-Za-z])/gi, "$1 $2");
  next = next.replace(/[A-Za-z][A-Za-z']*/g, (token) => openToken(token));
  if (/teamoften/i.test(original)) next = next.replace(/\bteam often\b/gi, "team of ten");
  return next;
}

export function forSpeech(text: string): string {
  let next = restoreSpokenGaps(String(text || ""));
  next = normaliseBrandCaps(next);
  next = next.replace(/\binterviewa\b/gi, "Interviewer");
  next = next.replace(/\bwhatsapp\b/gi, "WhatsApp");
  next = next.replace(/\btwenty-?four\s*seven\b/gi, "twenty four seven");
  next = next.replace(/\baeo\b/gi, "A E O");
  next = next.replace(/\bseo\b/gi, "S E O");
  next = rewriteLive(next);
  return rewriteSalesLead(next);
}

export function forTranscript(text: string): string {
  return String(text || "").replace(/\bInterviewer\b/g, "Interviewa");
}

export function pronunciationRules(): string {
  return `Speech wording. Always write the product name Adam, never ADAM. The brand is written Interviewa and pronounced interviewer. Always write Interviewa, never Interviewer, when you mean the product. Always leave a normal space between words. Do not use the adjective live for a demo, a call, a chat, or going live. Say in real time, real, working, or up and running. Where do you live stays as it is. Do not say lead or leads for a sales enquiry. Say enquiry, potential customer, or new customer. Leave lead the way and lead to unchanged. Say S E O and A E O as separate letters. Say WhatsApp as WhatsApp.`;
}
