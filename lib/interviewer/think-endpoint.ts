import { createHmac, timingSafeEqual } from "crypto";

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
