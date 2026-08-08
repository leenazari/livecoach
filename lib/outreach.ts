import { supabaseAdmin } from "@/lib/supabase";

export const OUTREACH_DAILY_HARD_LIMIT = 20;
export const OUTREACH_TIME_ZONE = "Europe/London";

export function londonDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OUTREACH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function londonDayBounds(date = new Date()): { start: string; end: string } {
  const day = londonDate(date);
  const midday = new Date(`${day}T12:00:00Z`);
  const offsetName = new Intl.DateTimeFormat("en-GB", {
    timeZone: OUTREACH_TIME_ZONE,
    timeZoneName: "longOffset",
  }).formatToParts(midday).find((part) => part.type === "timeZoneName")?.value || "GMT+00:00";
  const offset = offsetName.replace("GMT", "") || "+00:00";
  const start = new Date(`${day}T00:00:00${offset}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function emailDomain(email: string): string {
  return String(email || "").toLowerCase().split("@")[1] || "";
}

export function modelText(message: any): string {
  return (Array.isArray(message?.content) ? message.content : [])
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("")
    .replace(/```json|```/g, "")
    .trim();
}

export function parseObject(text: string): Record<string, any> | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
  } catch {
    return null;
  }
}

export function modelSources(message: any): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const part of Array.isArray(message?.content) ? message.content : []) {
    if (part?.type !== "web_search_tool_result" || !Array.isArray(part.content)) continue;
    for (const result of part.content) {
      const url = typeof result?.url === "string" ? result.url : "";
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ title: String(result.title || url), url });
    }
  }
  return out.slice(0, 8);
}

export async function activeClientDomains(): Promise<Set<string>> {
  const { data } = await supabaseAdmin.from("companies").select("domain,website").limit(1000);
  const domains = new Set<string>();
  for (const company of data || []) {
    const raw = String(company.domain || company.website || "").trim();
    if (!raw) continue;
    try {
      domains.add(new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "").toLowerCase());
    } catch {
      domains.add(raw.replace(/^www\./, "").toLowerCase());
    }
  }
  return domains;
}

export function stepDelay(sequence: any, step: number): number {
  const rows = Array.isArray(sequence) ? sequence : [];
  const found = rows.find((row: any) => Number(row?.step) === step);
  return Math.max(1, Number(found?.delayDays) || 3);
}
