import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendBrainCallFocusNote,
  resolveBrainCallActionCandidates,
} from "../lib/brain-call-actions.ts";
import {
  brainActionSignature,
  sameBrainAction,
} from "../lib/brain-action-signatures.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const assistantRoute = read("app/api/crm/assistant/route.ts");
const upcomingRoute = read("app/api/crm/upcoming/[id]/route.ts");
const assistantClient = read("components/crm/ClientAssistant.tsx");
const callPage = read("app/call/page.tsx");

const calls = [
  {
    id: "wednesday-call",
    title: "Daily Standup",
    scheduled_at: "2026-09-02T09:00:00Z",
  },
  {
    id: "thursday-call",
    title: "Daily Standup",
    scheduled_at: "2026-09-03T09:00:00Z",
    attendees: [{ name: "Jay" }],
  },
  {
    id: "thursday-nine-call",
    title: "Daily Standup",
    scheduled_at: "2026-09-03T08:00:00Z",
  },
  {
    id: "friday-call",
    title: "Daily Standup",
    scheduled_at: "2026-09-04T09:00:00Z",
  },
  {
    id: "thursday-ten-pm-call",
    title: "Daily Standup",
    scheduled_at: "2026-09-03T21:00:00Z",
  },
];
const now = new Date("2026-09-02T18:30:00Z");

assert.deepEqual(
  resolveBrainCallActionCandidates(
    calls,
    "Daily Standup - Thu 03 Sept, 10:00",
    now
  ).map((call) => call.id),
  ["thursday-call"],
  "The exact UK date and time must select Thursday rather than the passed Wednesday occurrence"
);
assert.deepEqual(
  resolveBrainCallActionCandidates(
    calls,
    "tomorrow's 10:00 call with Jay",
    now
  ).map((call) => call.id),
  ["thursday-call"]
);
assert.deepEqual(
  resolveBrainCallActionCandidates(calls, "Daily Standup", now).map(
    (call) => call.id
  ),
  [
    "thursday-nine-call",
    "thursday-call",
    "thursday-ten-pm-call",
    "friday-call",
  ],
  "A title-only recurring call remains a visible choice instead of being guessed"
);
assert.deepEqual(
  resolveBrainCallActionCandidates(
    calls,
    "Daily Standup - Sat 05 Sept, 10:00",
    now
  ),
  [],
  "A missing exact schedule must fail closed"
);
assert.deepEqual(
  resolveBrainCallActionCandidates(
    calls,
    "Board Review - Thu 03 Sept, 10:00",
    now
  ),
  [],
  "A unique time must not override a conflicting call identity"
);

const existingPrep = {
  selectedComps: ["Review the release evidence"],
  suggestedComps: ["Review the release evidence"],
  openingQuestions: ["What failed?"],
};
const note =
  "Review where support chats are going, who owns them, and agree escalation with Jay";
const appended = appendBrainCallFocusNote(
  "Agree the release plan",
  existingPrep,
  note
);
assert.equal(appended.intentChanged, true);
assert.equal(appended.focusAdded, true);
assert.match(appended.intent, /Agree the release plan[\s\S]*Review where support chats/);
assert.deepEqual(appended.prep.selectedComps, [
  "Review the release evidence",
  note,
]);
assert.deepEqual(appended.prep.suggestedComps, [
  "Review the release evidence",
  note,
]);
assert.deepEqual(appended.prep.openingQuestions, ["What failed?"]);
assert.equal(appended.prep.focusBasisBrief, appended.intent);
assert.equal(appended.prep.planStage, "focus");

const repeated = appendBrainCallFocusNote(appended.intent, appended.prep, note);
assert.equal(repeated.intentChanged, false);
assert.equal(repeated.focusAdded, false);
assert.equal(repeated.prep.selectedComps.filter((item) => item === note).length, 1);

const wrongCall = brainActionSignature({
  type: "add_intent",
  endpoint: "/api/crm/upcoming/wednesday-call",
  label: `Add to focus ${note}`,
});
const correctCall = brainActionSignature({
  type: "add_intent",
  endpoint: "/api/crm/upcoming/thursday-call",
  label: `Add to focus ${note}`,
});
assert.equal(
  sameBrainAction(wrongCall, correctCall),
  false,
  "Correcting the same note onto a different call must not be suppressed as a duplicate"
);
assert.equal(sameBrainAction(correctCall, correctCall), true);

assert.match(assistantRoute, /resolveBrainCallActionCandidates/);
assert.doesNotMatch(
  assistantRoute.match(/async function findCalls[\s\S]*?\n}/)?.[0] || "",
  /\.ilike\("title"/,
  "Call actions must not search the combined title, date and time as one database title"
);
assert.match(assistantRoute, /body: \{ appendIntentNote: note \}/);
assert.match(
  assistantRoute.match(/async function findCalls[\s\S]*?\n}/)?.[0] || "",
  /\.eq\("workspace_id", requestScope\.workspaceId\)[\s\S]*\.eq\("owner_id", requestScope\.userId\)/,
  "Brain call action lookup must remain inside the signed-in user's account"
);
assert.match(assistantRoute, /callWhen\(calls\[0\]\.scheduled_at\)/);
assert.match(upcomingRoute, /appendBrainCallFocusNote/);
assert.match(upcomingRoute, /patch\.prepped = true/);
assert.match(upcomingRoute, /focusNoteAdded/);
assert.match(
  upcomingRoute,
  /\.eq\("workspace_id", account\.workspaceId\)[\s\S]{0,100}\.eq\("owner_id", account\.userId\)/
);
assert.match(assistantClient, /lc:upcoming-call-updated/);
assert.match(assistantClient, /LiveCoach did not confirm the exact call/);
assert.match(callPage, /addEventListener\("lc:upcoming-call-updated"/);

console.log("Brain exact call focus validation passed");
