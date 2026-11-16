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

export function normaliseBrandCaps(text: string): string {
  return text.replace(/\b[A-Z]{3,}\b/g, (word) => (
    ACRONYMS.has(word) ? word : word.charAt(0) + word.slice(1).toLowerCase()
  ));
}

export function rewriteLive(text: string): string {
  let next = text;
  for (const [pattern, replacement] of LIVE_PHRASES) next = next.replace(pattern, replacement);
  return next;
}

export function rewriteSalesLead(text: string): string {
  let next = text;
  for (const [pattern, replacement] of LEAD_PHRASES) next = next.replace(pattern, replacement);
  return next;
}

export function forPrompt(text: string): string {
  return normaliseBrandCaps(String(text || ""));
}

// Pass words through unchanged. Spaces are kept where the model wrote them.
export function restoreSpokenGaps(text: string): string {
  return String(text || "");
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
