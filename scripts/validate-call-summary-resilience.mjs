import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isTransientSummaryFailure,
  withTransientSummaryRetry,
} from "../lib/call-summary-retry.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

assert.equal(isTransientSummaryFailure(new Error("429 rate limit")), true);
assert.equal(isTransientSummaryFailure(new Error("503 unavailable")), true);
assert.equal(isTransientSummaryFailure(new Error("fetch failed")), true);
assert.equal(isTransientSummaryFailure(new Error("400 invalid request")), false);

let transientAttempts = 0;
const recovered = await withTransientSummaryRetry(
  async () => {
    transientAttempts += 1;
    if (transientAttempts === 1) throw new Error("503 temporarily unavailable");
    return "ready";
  },
  { attempts: 2, delayMs: 0 }
);
assert.equal(recovered, "ready");
assert.equal(transientAttempts, 2);

let permanentAttempts = 0;
await assert.rejects(
  withTransientSummaryRetry(
    async () => {
      permanentAttempts += 1;
      throw new Error("400 invalid request");
    },
    { attempts: 2, delayMs: 0 }
  )
);
assert.equal(permanentAttempts, 1);

const sessionEnd = read("app/api/interview/session-end/route.ts");
const statusRoute = read("app/api/interview/summary-status/route.ts");
const summaryRoute = read("app/api/interview/summary/route.ts");
const retryRoute = read("app/api/interview/retry-summary/route.ts");
const backfillRoute = read("app/api/interview/backfill-scorecards/route.ts");
const job = read("lib/call-summary-jobs.ts");
const callPage = read("app/call/page.tsx");
const vercel = JSON.parse(read("vercel.json"));

assert.match(sessionEnd, /waitUntil\(processing\)/);
assert.match(sessionEnd, /runCallSummaryJob\(req, payload\)/);
assert.match(sessionEnd, /summaryQueued/);
assert.match(callPage, /summaryRequest/);
assert.match(callPage, /\/api\/interview\/summary-status\?sessionId=/);
assert.match(callPage, /Continue to CRM/);
assert.match(callPage, /summary will finish automatically/);
assert.doesNotMatch(callPage, /fetch\("\/api\/interview\/summary",/);

assert.match(summaryRoute, /withTransientSummaryRetry/);
assert.match(retryRoute, /waitUntil\(processing\)/);
assert.match(job, /summaryClaimIsFresh/);
assert.match(job, /\.eq\("owner_id", accountScope\.userId\)/);
assert.match(statusRoute, /\.eq\("owner_id", accountScope\.userId\)/);
assert.match(backfillRoute, /listActiveAccountScopes\(\)/);
assert.match(backfillRoute, /runWithServiceRecordScope/);
assert.match(backfillRoute, /\.eq\("owner_id", accountScope\.userId\)/);

assert(
  vercel.crons.some(
    (cron) =>
      cron.path === "/api/interview/backfill-scorecards" &&
      cron.schedule === "*/5 * * * *"
  ),
  "The durable call-summary recovery cron must run every five minutes"
);

console.log("Non-blocking call summary resilience checks passed");
