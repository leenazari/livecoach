import { createHmac, timingSafeEqual } from "crypto";

// A protected preview blocks Deepgram unless the bypass secret is present.
// Without that secret the custom route is not used, and Voice Agent keeps
// its managed OpenAI think step so the call still connects.
export function customThinkUrl(input: {
  origin: string | null;
  expiresAt: number;
  openAiKey: string;
  bypassSecret: string;
}): string | null {
  const key = input.openAiKey.trim();
  const bypass = input.bypassSecret.trim();
  const origin = (input.origin || "").replace(/\/$/, "");
  if (!key || !bypass || !origin) return null;
  let host = "";
  try {
    host = new URL(origin).host;
  } catch {
    return null;
  }
  if (/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) return null;
  return interviewerThinkUrl(origin, input.expiresAt, key);
}

export function interviewerThinkUrl(origin: string, expiresAt: number, key: string): string {
  const sig = createHmac("sha256", key).update(`interviewer-think:${expiresAt}`).digest("hex");
  const url = new URL("/api/interviewer/think", origin);
  url.searchParams.set("exp", String(expiresAt));
  url.searchParams.set("sig", sig);
  return url.toString();
}

export function thinkRequestAllowed(expRaw: string | null, sig: string | null, key: string, now = Date.now()): boolean {
  const exp = Number(expRaw);
  if (!key || !sig || !Number.isFinite(exp) || exp < now) return false;
  const expected = createHmac("sha256", key).update(`interviewer-think:${exp}`).digest("hex");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
