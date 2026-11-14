import { effectiveCallMinutes } from "./call-limit";

export const PUBLIC_CALLS_TITLE = "Public calls";
export const PUBLIC_CALLS_OFF = "off";
export const PUBLIC_INVITE_HOURS = 4;
export const PUBLIC_IP_LIMIT = 5;
export const PUBLIC_IP_WINDOW_MS = 10 * 60 * 1000;
export const PUBLIC_EMAIL_LIMIT = 3;
export const PUBLIC_EMAIL_WINDOW_MS = 60 * 60 * 1000;
export const PUBLIC_CAMPAIGN_LIMIT = 30;
export const PUBLIC_CAMPAIGN_WINDOW_MS = 10 * 60 * 1000;

export type PublicCampaignView = {
  id: string;
  name: string;
  summary: string;
  accepting: boolean;
  maxMinutes: number;
  heroUrl: string | null;
  heroAlt: string;
  accent: string;
  accentOn: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const hits = new Map<string, number[]>();

export function isCampaignToken(value: string): boolean {
  return UUID.test(value);
}

export function publicCampaignPath(campaignId: string): string {
  return `/c/${campaignId}`;
}

export function publicCallsOpen(documents: Array<{ title?: string | null; body?: string | null }>): boolean {
  return !documents.some((document) => {
    const title = String(document.title || "").trim().toLowerCase();
    const body = String(document.body || "").trim().toLowerCase();
    return title === PUBLIC_CALLS_TITLE.toLowerCase() && body === PUBLIC_CALLS_OFF;
  });
}

export function publicSummary(name: string, documents: Array<{ title?: string | null; body?: string | null }>, slideLine = ""): string {
  const notes = documents.filter((document) => {
    const title = String(document.title || "").trim().toLowerCase();
    return title && title !== PUBLIC_CALLS_TITLE.toLowerCase() && title !== "qualifying questions" && title !== "source website";
  });
  const summary = notes.find((document) => /summary|about|overview/i.test(String(document.title || ""))) || notes[0];
  const body = String(summary?.body || "").replace(/\s+/g, " ").trim();
  const sentence = body.split(/(?<=\.)\s/)[0]?.trim() || "";
  const line = sentence || String(slideLine || "").replace(/\s+/g, " ").trim();
  return (line || name).slice(0, 180);
}

export function publicCallMinutes(stored: number | null | undefined): number {
  return effectiveCallMinutes(stored);
}

export function validatePublicLead(input: { name: string; email: string }): { fields: Record<string, string>; name: string; email: string } {
  const fields: Record<string, string> = {};
  const name = input.name.replace(/\s+/g, " ").trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !/[a-z]/i.test(name)) fields.prospectName = "Add your name.";
  else if (name.length > 160) fields.prospectName = `Name is ${name.length} characters; the limit is 160.`;
  if (!email) fields.prospectEmail = "Add your email address.";
  else if (email.length > 254 || !EMAIL.test(email)) fields.prospectEmail = "Enter an email address like name@company.com.";
  return { fields, name, email };
}

export function honeypotTripped(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

export function clientAddress(header: string | null): string {
  const first = String(header || "").split(",")[0]?.trim() || "";
  if (!first || first.length > 64 || !/^[0-9a-f:.]+$/i.test(first)) return "";
  return first;
}

export function resetPublicJoinLimits(): void {
  hits.clear();
}

export function allowPublicJoin(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (!key) return true;
  const recent = (hits.get(key) || []).filter((at) => now - at < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
