import { isInterviewerVoiceId, type InterviewerVoiceId } from "@/lib/interviewer/voices";

export type CampaignInput = {
  name: string;
  voiceId: InterviewerVoiceId;
  maxMinutes: number | null;
  ratePerMinute: number;
  currency: "GBP" | "USD" | "EUR";
  marginPercent: number;
  billingGranularity: "second" | "minute";
  personaOverride: string | null;
  promptOverride: string | null;
};

const CURRENCIES = new Set(["GBP", "USD", "EUR"]);

export function parseCampaignInput(body: Record<string, unknown>): { ok: true; value: CampaignInput } | { ok: false; message: string } {
  const name = String(body.name || "").trim();
  if (name.length < 1 || name.length > 160) {
    return { ok: false, message: "Give the campaign a name of up to 160 characters." };
  }
  if (!isInterviewerVoiceId(body.voiceId)) {
    return { ok: false, message: "Choose the British male voice or the British female voice." };
  }
  const rawCap = body.maxMinutes;
  const cap = rawCap === null || rawCap === undefined || String(rawCap).trim() === "" ? 30 : Number(rawCap);
  if (!Number.isInteger(cap) || cap < 1 || cap > 30) {
    return { ok: false, message: "The call limit is a whole number of minutes from 1 to 30." };
  }
  const maxMinutes = cap;
  const rate = Number(body.ratePerMinute ?? 0);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100000) {
    return { ok: false, message: "The rate per minute needs to be a number that is zero or more." };
  }
  const currency = String(body.currency || "GBP").toUpperCase();
  if (!CURRENCIES.has(currency)) {
    return { ok: false, message: "Currency must be GBP, USD or EUR." };
  }
  const margin = Number(body.marginPercent ?? 0);
  if (!Number.isFinite(margin) || margin < 0 || margin >= 100) {
    return { ok: false, message: "Margin percent must be from 0 up to, but not including, 100. It is already included in the rate." };
  }
  const granularity = body.billingGranularity === "minute" ? "minute" : body.billingGranularity === "second" ? "second" : "";
  if (!granularity) return { ok: false, message: "Billing granularity must be second or minute." };
  const persona = String(body.personaOverride || "").trim();
  const prompt = String(body.promptOverride || "").trim();
  if (persona.length > 4000 || prompt.length > 8000) {
    return { ok: false, message: "The persona or prompt note is too long." };
  }
  return {
    ok: true,
    value: {
      name,
      voiceId: body.voiceId,
      maxMinutes,
      ratePerMinute: Math.round(rate * 10000) / 10000,
      currency: currency as CampaignInput["currency"],
      marginPercent: Math.round(margin * 100) / 100,
      billingGranularity: granularity,
      personaOverride: persona || null,
      promptOverride: prompt || null,
    },
  };
}
