import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMAIL_OTP_LENGTH,
  emailOtpErrorMessage,
  emailOtpRedirect,
  normalizeEmailOtp,
} from "../lib/email-otp.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

assert.equal(EMAIL_OTP_LENGTH, 6);
assert.equal(normalizeEmailOtp("12 3a45-678"), "123456");
assert.equal(
  emailOtpRedirect("https://www.livecoachcrm.com"),
  "https://www.livecoachcrm.com/auth/callback?next=%2Fcrm&method=email"
);
assert.match(emailOtpErrorMessage({ status: 429 }), /Too many login emails/);
assert.match(
  emailOtpErrorMessage({ code: "otp_expired" }),
  /expired or has already been used/
);

const login = read("app/login/page.tsx");
const callback = read("app/auth/callback/route.ts");
const forgot = read("app/forgot-password/page.tsx");
const magicLinkTemplate = read("supabase/templates/magic-link.html");

assert.match(login, /signInWithOtp/);
assert.match(login, /shouldCreateUser: false/);
assert.match(login, /verifyOtp/);
assert.match(login, /type: "email"/);
assert.match(login, /autoComplete="one-time-code"/);
assert.match(login, /signInWithPassword/);
assert.match(login, /EMAIL_RESEND_WAIT_SECONDS = 60/);
assert.doesNotMatch(login, /SERVICE_ROLE|auth\.admin/);
assert.match(callback, /authenticationMethod === "email"/);
assert.match(callback, /verificationType === "email"/);
assert.match(callback, /\/login\?email=error/);
assert.match(forgot, /Use email login/);
assert.match(magicLinkTemplate, /\{\{ \.TokenHash \}\}/);
assert.match(magicLinkTemplate, /\{\{ \.Token \}\}/);
assert.match(
  magicLinkTemplate,
  /\/auth\/callback\?token_hash=\{\{ \.TokenHash \}\}&amp;type=email&amp;next=\/crm&amp;method=email/
);
assert.doesNotMatch(magicLinkTemplate, /\.ConfirmationURL/);

console.log("Email OTP login validation passed");
