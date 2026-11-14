import { isInterviewerVoiceId, type InterviewerVoiceId } from "@/lib/interviewer/voices";

export type FieldErrors = Record<string, string>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCIES = new Set(["GBP", "USD", "EUR"]);

export function knowledgeTitleFromNote(note: string): string {
  const flat = note.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  if (flat.length <= 60) return flat;
  const sliced = flat.slice(0, 60);
  const word = sliced.replace(/\s+\S*$/, "").trim();
  return word.length >= 12 ? word : sliced.trim();
}

export function validateKnowledgeNote(input: {
  campaignId: string;
  title: string;
  body: string;
}): { fields: FieldErrors; title: string; body: string } {
  const fields: FieldErrors = {};
  const body = input.body.trim();
  if (!UUID.test(input.campaignId)) fields.campaignId = "Pick a campaign.";
  if (!body) fields.body = "Add the note.";
  else if (body.length > 20000) {
    fields.body = `Note is ${body.length.toLocaleString("en-GB")} characters; the limit is 20,000.`;
  }
  let title = input.title.trim();
  if (!title && body && !fields.body) title = knowledgeTitleFromNote(body);
  if (title.length > 160) fields.title = `Title is ${title.length} characters; the limit is 160.`;
  return { fields, title, body };
}

export function validateCampaignFields(input: {
  name: string;
  voiceId: string;
  maxMinutes: string;
}): { fields: FieldErrors; name: string; voiceId: InterviewerVoiceId | null; maxMinutes: number | null } {
  const fields: FieldErrors = {};
  const name = input.name.trim();
  if (!name) fields.name = "Add a campaign name.";
  else if (name.length > 160) fields.name = `Name is ${name.length} characters; the limit is 160.`;
  if (!input.voiceId) fields.voiceId = "Choose a voice.";
  else if (!isInterviewerVoiceId(input.voiceId)) fields.voiceId = "Choose one of the British voices.";
  let maxMinutes: number | null = null;
  const raw = input.maxMinutes.trim();
  if (raw) {
    const cap = Number(raw);
    if (!Number.isInteger(cap) || cap < 1 || cap > 180) {
      fields.maxMinutes = "Max minutes must be empty, or a whole number from 1 to 180.";
    } else maxMinutes = cap;
  }
  return { fields, name, voiceId: isInterviewerVoiceId(input.voiceId) ? input.voiceId : null, maxMinutes };
}

export function validateInviteFields(input: {
  campaignId: string;
  prospectName: string;
  prospectEmail: string;
}): FieldErrors {
  const fields: FieldErrors = {};
  if (!UUID.test(input.campaignId)) fields.campaignId = "Pick a campaign.";
  const name = input.prospectName.trim();
  if (!name) fields.prospectName = "Add the prospect's name.";
  else if (name.length > 160) fields.prospectName = `Name is ${name.length} characters; the limit is 160.`;
  const email = input.prospectEmail.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fields.prospectEmail = "That email address does not look usable. Leave it blank or correct it.";
  }
  return fields;
}

export function validateBillingFields(input: {
  ratePerMinute: string;
  currency: string;
  marginPercent: string;
  billingGranularity: string;
}): { fields: FieldErrors; ratePerMinute: number; currency: "GBP" | "USD" | "EUR" | null; marginPercent: number; billingGranularity: "second" | "minute" | null } {
  const fields: FieldErrors = {};
  const rate = Number(input.ratePerMinute);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100000) {
    fields.ratePerMinute = "Rate per minute must be a number from 0 up.";
  }
  const currency = input.currency.toUpperCase();
  if (!CURRENCIES.has(currency)) fields.currency = "Currency must be GBP, USD or EUR.";
  const margin = Number(input.marginPercent);
  if (!Number.isFinite(margin) || margin < 0 || margin >= 100) {
    fields.marginPercent = "Margin percent must be from 0 up to, but not including, 100.";
  }
  const granularity = input.billingGranularity === "minute" || input.billingGranularity === "second"
    ? input.billingGranularity
    : null;
  if (!granularity) fields.billingGranularity = "Billing granularity must be second or minute.";
  return {
    fields,
    ratePerMinute: Number.isFinite(rate) ? Math.round(rate * 10000) / 10000 : 0,
    currency: CURRENCIES.has(currency) ? currency as "GBP" | "USD" | "EUR" : null,
    marginPercent: Number.isFinite(margin) ? Math.round(margin * 100) / 100 : 0,
    billingGranularity: granularity,
  };
}

export function preferredCampaignId(campaigns: Array<{ id: string }>, current: string): string {
  if (current && campaigns.some((campaign) => campaign.id === current)) return current;
  return campaigns[0]?.id || "";
}
