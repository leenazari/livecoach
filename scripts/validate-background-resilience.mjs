import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isTransientOpenAIError,
  OpenAIResponsesError,
} from "../lib/openai.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

assert.equal(
  isTransientOpenAIError(new OpenAIResponsesError(503, "temporarily unavailable")),
  true
);
assert.equal(
  isTransientOpenAIError(new OpenAIResponsesError(429, "rate limited")),
  true
);
assert.equal(
  isTransientOpenAIError(new OpenAIResponsesError(400, "invalid request")),
  false
);
assert.equal(isTransientOpenAIError(new Error("network fetch failed")), true);

const openai = read("lib/openai.ts");
const runningSummary = read("app/api/interview/running-summary/route.ts");
const insight = read("app/api/interview/insight/route.ts");
const suggest = read("app/api/interview/suggest/route.ts");
const digest = read("app/api/cron/daily-digest/route.ts");
const emailReplyMigration = read(
  "supabase/migrations/20260831135749_allow_client_email_reply_context.sql"
);

assert.match(openai, /RESPONSE_ATTEMPTS = 2/);
assert.match(openai, /isTransientOpenAIError\(lastError\)/);
assert.match(openai, /setTimeout\(resolve, 350 \* attempt\)/);
assert.match(runningSummary, /preserving prior state/);
assert.match(runningSummary, /cleanRunningSummary\(previousBullets\)/);
assert.match(runningSummary, /x-livecoach-degraded/);
assert.match(insight, /temporarily unavailable, returning HOLD/);
assert.match(insight, /new Response\("HOLD"/);
assert.match(suggest, /let wroteContent = false/);
assert.match(suggest, /if \(!wroteContent\) controller\.enqueue\(encoder\.encode\("HOLD"\)\)/);
assert.match(suggest, /finalMessage\(\)\.catch/);

assert.match(digest, /status: "action_required"/);
assert.match(digest, /connect\|reconnect\|not connected\|permission\|scope/);
assert.match(digest, /const actionRequired = results\.filter/);
assert.match(digest, /status: failed \? 500 : 200/);

assert.match(emailReplyMigration, /'email_reply'/);
assert.match(emailReplyMigration, /client_context_kind_check/);

console.log("Background resilience checks passed");
