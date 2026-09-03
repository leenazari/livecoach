import { safeLocalRedirect } from "./safe-local-redirect.ts";

export const EMAIL_OTP_LENGTH = 6;

export function normalizeEmailOtp(value: string): string {
  return value.replace(/\D/g, "").slice(0, EMAIL_OTP_LENGTH);
}

export function emailOtpRedirect(origin: string, next = "/crm"): string {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("next", safeLocalRedirect(next, "/crm"));
  url.searchParams.set("method", "email");
  return url.toString();
}

export function emailOtpErrorMessage(error: unknown): string {
  const authError = error as {
    status?: number;
    code?: string;
    message?: string;
  } | null;
  const code = String(authError?.code || "").toLowerCase();
  const message = String(authError?.message || "").toLowerCase();

  if (
    authError?.status === 429 ||
    code.includes("rate_limit") ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  ) {
    return "Too many login emails have been requested. Wait before trying again and use only the newest email.";
  }

  if (
    code.includes("otp_expired") ||
    message.includes("expired") ||
    message.includes("invalid token")
  ) {
    return "That code has expired or has already been used. Request one new email and use its newest code.";
  }

  return "That login could not be completed. Check the email and code, then try again.";
}
