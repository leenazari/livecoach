import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { captureAdmissionTimeouts, captureElapsedSeconds } from "../lib/call-capture-lifecycle.ts";

const start = Date.parse("2026-10-21T16:23:34Z");
const stop = Date.parse("2026-10-21T16:28:38Z");
const nextMorning = Date.parse("2026-10-22T09:23:34Z");
assert.equal(captureElapsedSeconds(start, stop, nextMorning), 304);
assert.equal(captureElapsedSeconds(start, null, start + 60000), 60);
assert.equal(captureElapsedSeconds(0, stop, nextMorning), 0);
assert.equal(captureElapsedSeconds(start, start - 60000, nextMorning), 0);
assert.deepEqual(captureAdmissionTimeouts("https://meet.google.com/abc-defg-hij", 10800), { preActivity: 900, waitingRoom: 600 });
assert.deepEqual(captureAdmissionTimeouts("https://teams.microsoft.com/l/meetup-join/test", 10800), { preActivity: 900, waitingRoom: 900 });
assert.deepEqual(captureAdmissionTimeouts("https://meet.google.com/abc-defg-hij", 120), { preActivity: 120, waitingRoom: 120 });

// Execute the real page's end handler with controlled refs, no network or AI.
// This catches the original early return that left an empty call's timer live.
const page = readFileSync(new URL("../app/call/page.tsx", import.meta.url), "utf8");
const handler = page.slice(page.indexOf("  const endAndSummarise = useCallback"), page.indexOf("\n  const briefRef", page.indexOf("  const endAndSummarise = useCallback")));
const compiled = ts.transpileModule(`${handler}\nresult.end = endAndSummarise;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const ref = (current) => ({ current });
function harness(text, providerEnd = stop) {
  const calls = [], statuses = [], values = {}, result = {};
  const context = {
    result, Date, Promise, console, setTimeout,
    useCallback: (fn) => fn,
    room: "private-test-call", manualRecap: false, recapText: "",
    linesRef: ref(text ? [{ text, role: "candidate", speaker: "Buyer" }] : []),
    callStartedAtRef: ref(start), callEndedAtRef: ref(providerEnd), callLiveRef: ref(true),
    endRequestedRef: ref(false), cueAbortRef: ref(null),
    sourceRef: ref("meet"), aiUsdRef: ref(0), suggestedCompsRef: ref([]),
    cachedSummaryRef: ref(null), cachedSigRef: ref(""), summaryPollCancelledRef: ref(false),
    sonnetCallsRef: ref(0), linkedCompanyRef: ref(null), linkedWorkstreamRef: ref(null),
    knowledgeRef: ref(""), roleRef: ref(""), candidateRef: ref("Buyer"),
    callTypeRef: ref("general"), upcomingIdRef: ref(null), favouritesRef: ref([]), notesRef: ref(""),
    lineSpeakerLabel: (line) => line.speaker, captureElapsedSeconds,
    estimateCost: (seconds) => ({ totalGBP: seconds / 3600 }),
    linkSession: () => {}, router: { push: () => { throw new Error("Unexpected redirect"); } },
    setStatus: (status) => statuses.push(status),
    fetch: async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (url === "/api/meet/stop") return Response.json({ ok: true });
      if (url === "/api/interview/session-end") return Response.json({ ok: true, summaryQueued: true });
      if (url.startsWith("/api/interview/summary-status")) return Response.json({ state: "ready", summary: { overview: "Saved" } });
      throw new Error(`Unexpected request ${url}`);
    },
  };
  for (const key of ["CallLive", "Ended", "SummaryTranscript", "Summary", "Summarising", "SummaryQueued", "SummaryLoadingMore"])
    context[`set${key}`] = (value) => { values[key] = value; };
  vm.runInNewContext(compiled, context);
  return { context, calls, statuses, values, end: result.end };
}

const empty = harness("");
await empty.end();
assert.equal(empty.context.callLiveRef.current, false);
assert.equal(empty.values.CallLive, false);
assert.equal(empty.context.callEndedAtRef.current, stop, "Provider end time survives even with no transcript");
assert.match(empty.statuses.at(-1), /No usable transcript.*Retry.*Recap/);
assert.equal(empty.calls.filter((call) => call.url.includes("session-end")).length, 0, "An empty admission cannot complete a meeting or incur summary cost");
assert.equal(empty.context.endRequestedRef.current, false, "The user can still retry or supply their own recap");

const captured = harness("We discussed the trial, agreed next steps and will arrange a demo next week.");
await captured.end();
const queued = captured.calls.find((call) => call.url === "/api/interview/session-end");
assert.ok(queued);
assert.equal(queued.body.totalCost, 304 / 3600, "Never save an overnight browser estimate as the capture cost");
assert.match(queued.body.transcript, /^Buyer:/);
assert.equal(captured.values.Ended, true);
assert.equal(captured.statuses.at(-1), "summary ready");
const requestCount = captured.calls.length;
await captured.end();
assert.equal(captured.calls.length, requestCount, "Manual tap and terminal event cannot queue two summaries");
assert.match(page, /sessionId !== room \|\| endRequestedRef.current/);
assert.match(page, /if \(sessionId === room\) void endAndSummarise/);
console.log("Capture admission, overnight estimate, empty-stop, canonical summary and idempotent finalisation checks passed");
