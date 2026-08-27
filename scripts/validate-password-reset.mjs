import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PASSWORD_MIN_LENGTH,
  passwordResetRedirect,
  passwordValidationError,
} from "../lib/password-reset.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

assert.equal(PASSWORD_MIN_LENGTH, 8);
assert.equal(
  passwordResetRedirect("https://www.livecoachcrm.com"),
  "https://www.livecoachcrm.com/reset-password"
);
assert.match(passwordValidationError("short", "short") || "", /at least 8/);
assert.match(passwordValidationError("longenough", "different") || "", /do not match/);
assert.equal(passwordValidationError("longenough", "longenough"), null);

const login = read("app/login/page.tsx");
const forgot = read("app/forgot-password/page.tsx");
const reset = read("app/reset-password/page.tsx");
const callback = read("app/auth/callback/route.ts");
const browserClient = read("lib/supabase-browser.ts");

assert.match(login, /href="\/forgot-password"/);
assert.match(login, /Password updated\. Sign in with your new password\./);
assert.match(forgot, /resetPasswordForEmail/);
assert.match(forgot, /If that email belongs to a LiveCoach account/);
assert.match(forgot, /over_email_send_rate_limit/);
assert.match(forgot, /Wait up to 60 minutes/);
assert.doesNotMatch(forgot, /admin\.|SERVICE_ROLE/);
assert.match(browserClient, /flowType: "implicit"/);
assert.match(browserClient, /persistSession: false/);
assert.match(
  browserClient,
  /createSupabasePasswordRecoveryClient[\s\S]*flowType: "implicit"[\s\S]*persistSession: true[\s\S]*detectSessionInUrl: true[\s\S]*storageKey: "livecoach-password-recovery"/
);
assert.match(reset, /createSupabasePasswordRecoveryClient/);
assert.doesNotMatch(reset, /createSupabaseBrowser/);
assert.match(reset, /updateUser\(\{ password \}\)/);
assert.match(reset, /signOut\(\{ scope: "global" \}\)/);
assert.match(reset, /passwordValidationError/);
assert.match(callback, /verificationType === "recovery"/);
assert.match(callback, /\/forgot-password\?reset=error/);

console.log("Password reset validation passed");
