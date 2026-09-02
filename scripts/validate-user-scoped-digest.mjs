import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const digest = read("app/api/cron/daily-digest/route.ts");
const testRoute = read("app/api/crm/digest-test/route.ts");
const testPage = read("app/crm/digest-test/page.tsx");
const sunday = read("app/api/cron/sunday-weekly-digest/route.ts");
const supabase = read("lib/supabase.ts");
const appConfig = read("lib/app-config.ts");
const origin = read("lib/public-app-url.ts");

// Every active connected account is processed. The old founder-only selector
// and fixed recipient must never return.
assert.match(
  digest,
  /listActiveAccountScopes\(\{ connectedOnly: true \}\)/
);
assert.doesNotMatch(digest, /ownersOnly\s*:\s*true/);
assert.doesNotMatch(digest, /const\s+RECIPIENT/);
assert.doesNotMatch(digest, /lee@ai13\.com/i);

// The selected account controls both the data scope and mailbox. No recipient
// may be accepted from a query string or browser body.
assert.match(digest, /runWithServiceRecordScope\(account/);
assert.match(digest, /runDigestForAccount\(req, account\)/);
assert.match(digest, /connectedMailProvider\(account\.userId\)/);
assert.match(digest, /to:\s*recipient/);
assert.match(digest, /sendConnectedMail\([\s\S]*?account\.userId\s*\)/);
assert.equal(
  (digest.match(/\.eq\("owner_id", account\.userId\)/g) || []).length,
  5,
  "calls, completed tasks, open tasks, tomorrow tasks and calendar events must stay personal"
);
assert.match(digest, /\.eq\("assigned_to_user_id", account\.userId\)/);
assert.doesNotMatch(
  digest,
  /searchParams\.get\(["'](?:to|recipient|email)["']\)/i
);

// Sent state remains private per owner, so one user's successful delivery can
// neither suppress nor duplicate another user's brief.
assert.match(digest, /SENT_KEY\s*=\s*["']daily_progress_email_last_sent["']/);
assert.match(appConfig, /visibility === "private" && row\.owner_id === scope\.userId/);
assert.doesNotMatch(
  appConfig.match(/TEAM_CONFIG_KEYS[\s\S]*?\]\);/)?.[0] || "",
  /daily_progress_email_last_sent/
);

// Test sends are pinned to the middleware-verified signed-in user. The service
// request goes to the current trusted deployment rather than leaking a secret
// to a browser-controlled Host value.
assert.match(testRoute, /const account = requireRequestScope\(\)/);
assert.match(testRoute, /url\.searchParams\.set\("account", account\.userId\)/);
assert.match(testRoute, /internalAppOrigin\(req\.nextUrl\.origin\)/);
assert.doesNotMatch(testRoute, /GET as sendDigest/);
assert.doesNotMatch(testRoute, /req\.json\(\)/);
assert.match(origin, /process\.env\.VERCEL_URL/);
assert.match(origin, /deployment-owned/);
assert.doesNotMatch(testPage, /lee@ai13\.com/i);
assert.match(testPage, /your own connected email address/i);

// The Sunday route delegates to the exact same per-user implementation. No AI
// provider is imported, so isolation adds no token-consuming reanalysis.
assert.match(sunday, /sendProgressDigest\(req\)/);
assert.doesNotMatch(digest, /@\/lib\/(?:openai|anthropic)/);

// Background reads remain restricted to this workspace and either the exact
// owner or deliberately team-visible records.
assert.match(supabase, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(
  supabase,
  /\.or\(`owner_id\.eq\.\$\{scope\.userId\},visibility\.eq\.team`\)/
);

console.log("Per-user daily and Sunday digest isolation checks passed");
