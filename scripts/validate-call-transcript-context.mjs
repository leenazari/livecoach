import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sourceUrl = new URL("../lib/call-transcript-context.ts", import.meta.url);
const source = (await readFile(sourceUrl, "utf8")).replace(
  'import { supabaseAdmin } from "@/lib/supabase";',
  "const supabaseAdmin = {};"
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const {
  callTranscriptRequested,
  scoreTranscriptCallCandidate,
  selectTranscriptExcerpt,
} = await import(moduleUrl);

assert.equal(
  callTranscriptRequested("What did Emma say in yesterday's call?"),
  true
);
assert.equal(
  callTranscriptRequested("What is my next action with Emma?"),
  false
);
assert.equal(
  callTranscriptRequested("Search the call with Emma for pricing"),
  true
);

const now = new Date("2026-08-19T10:00:00Z");
const emma = {
  summaryId: "11111111-1111-1111-1111-111111111111",
  sessionId: "emma-session",
  candidate: "Emma Champion",
  title: "Interviewa training",
  companyName: "Emma Champion",
  scheduledAt: "2026-08-18T13:00:00Z",
};
const daniela = {
  summaryId: "22222222-2222-2222-2222-222222222222",
  sessionId: "daniela-session",
  candidate: "Daniela Asso",
  title: "Training review",
  companyName: "Daniela Asso",
  scheduledAt: "2026-08-18T13:00:00Z",
};
const query = "What did Emma say in yesterday's call at 2pm?";
assert.ok(
  scoreTranscriptCallCandidate(emma, query, { now }) >
    scoreTranscriptCallCandidate(daniela, query, { now }),
  "a person match must beat another call at the same time"
);
assert.equal(
  scoreTranscriptCallCandidate(daniela, "read this call", {
    now,
    screenCallId: daniela.summaryId,
  }),
  200,
  "the exact open call page must be authoritative"
);

const turns = Array.from({ length: 90 }, (_, index) =>
  index === 47
    ? "Emma: Pricing needs to stay simple for the first pilot and procurement will review it next week."
    : `Speaker: General discussion item ${index} about implementation and routine delivery.`
).join("\n");
const focused = selectTranscriptExcerpt(
  turns,
  "What did Emma say about pricing and procurement?",
  900
);
assert.equal(focused.partial, true);
assert.equal(focused.matched, true);
assert.match(focused.text, /Pricing needs to stay simple/);
assert.ok(focused.text.length <= 900);

const broad = selectTranscriptExcerpt(turns, "read me the transcript", 900);
assert.equal(broad.partial, true);
assert.match(broad.text, /General discussion item 0/);
assert.match(broad.text, /General discussion item 87/);
assert.match(broad.text, /omitted transcript section/);

console.log("call transcript matching validation passed");
