import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_SILENCE_AUTO_END_MS,
  CALL_SILENCE_WARNING_MS,
  callSilenceRemainingMs,
} from "../lib/call-silence.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const startRoute = read("app/api/meet/start/route.ts");
const meetStage = read("components/MeetStage.tsx");
const callPage = read("app/call/page.tsx");

assert.equal(CALL_SILENCE_AUTO_END_MS, 300_000);
assert.equal(CALL_SILENCE_WARNING_MS, 60_000);
assert.equal(callSilenceRemainingMs(0, 1_000), null);
assert.equal(callSilenceRemainingMs(1_000, 241_000), 60_000);
assert.equal(callSilenceRemainingMs(1_000, 301_000), 0);

assert.match(startRoute, /silence_detection:\s*\{[\s\S]*?timeout:\s*300/);
assert.match(startRoute, /silentFallbackMinutes:\s*5/);
assert.match(meetStage, /if \(wsState !== "on"\) return/);
assert.match(meetStage, /const backfillVerified = await deliverBackfill/);
assert.match(meetStage, /!backfillVerified/);
assert.match(meetStage, /visibilitychange/);
assert.match(meetStage, /onSilenceTimeoutRef\.current\(\)/);
assert.match(meetStage, /Speak to keep it open/);
assert.match(callPage, /endRequestedRef/);
assert.match(callPage, /onSilenceTimeout=\{\(\) =>/);
assert.match(callPage, /five minutes of silence detected - ending and summarising/);

console.log("Five-minute call silence auto-end validation passed");
