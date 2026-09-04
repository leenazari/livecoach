import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStrategicCoachingTranscript,
  hostSpeakingStats,
  keepGroundedHostQuotes,
  speakerMatchesPerson,
} from "../lib/coaching-transcript.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

assert.equal(speakerMatchesPerson("Team member Lee Nazari", "Lee Nazari"), true);
assert.equal(speakerMatchesPerson("Team member Lee Nazari", "Kamm Bachu"), false);
assert.equal(speakerMatchesPerson("Team member Kamm Bachu", "Kamm"), true);
assert.equal(speakerMatchesPerson("You", "Kamm Bachu", false), false);
assert.equal(speakerMatchesPerson("You", "Lee Nazari", true), true);

const transcript = [
  "Murali: We have several recruitment businesses and failed placements cost us time.",
  "Team member Lee Nazari: Which business has the most expensive failed placements, and how often does that happen?",
  "Murali: Hospitality has the highest volume.",
  "Team member Kamm Bachu: I can arrange a pilot account.",
  "Murali: We currently use another platform.",
  "Team member Lee Nazari: Where would Interviewa need to outperform it for you to trial us?",
  "Murali: Better preparation evidence would matter.",
  "Team member Lee Nazari: Can we book Tuesday to choose one pilot and owner?",
].join("\n");

assert.deepEqual(hostSpeakingStats(transcript, "Kamm Bachu", false), {
  turns: 1,
  words: 6,
});
assert.equal(hostSpeakingStats(transcript, "Lee Nazari", false).turns, 3);

const selected = buildStrategicCoachingTranscript(
  transcript,
  "Lee Nazari",
  30000,
  false
);
assert.match(selected, /most expensive failed placements/i);
assert.match(selected, /outperform it for you to trial us/i);
assert.match(selected, /book Tuesday/i);
assert.ok(selected.length <= 30000);

const grounded = keepGroundedHostQuotes(
  [
    {
      quote: "Can we book Tuesday to choose one pilot and owner?",
      better: "Can we lock that in now?",
    },
    {
      quote: "Hospitality has the highest volume.",
      better: "How many hires is that?",
    },
  ],
  transcript,
  "Lee Nazari",
  false
);
assert.equal(grounded.length, 1);
assert.match(grounded[0].quote, /book Tuesday/i);

const route = read("app/api/interview/coaching-debrief/route.ts");
assert.match(route, /requireRequestScope/);
assert.match(route, /loadSharedCallAccess/);
assert.match(route, /sharedAccess\?\.access[\s\S]{0,40}upcoming_id/);
assert.match(route, /buildStrategicCoachingTranscript/);
assert.match(route, /call\.allowGenericHostLabels/);
assert.match(route, /keepGroundedHostQuotes\([\s\S]*?existingPoints\(call\.sessionId\)/);
assert.doesNotMatch(route, /slice\(-14000\)/);

const page = read("app/crm/calls/[id]/page.tsx");
assert.match(page, /each teammate is coached privately/);
assert.match(page, /coachNote/);

console.log("Shared-call speaker-specific coaching checks passed");
