import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  needsOvernightOutreachPreparation,
  roundRobinPreparationJobs,
} from "../lib/outreach-overnight-preparation.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const base = {
  id: "enrolment-1",
  status: "queued",
  prospect: { id: "prospect-1" },
  sequenceStep: { channel: "email" },
};

assert.equal(needsOvernightOutreachPreparation(base), true);
assert.equal(
  needsOvernightOutreachPreparation({
    ...base,
    sequenceStep: { channel: "linkedin" },
  }),
  false
);
assert.equal(
  needsOvernightOutreachPreparation({
    ...base,
    status: "approved",
    message: { status: "approved", subject: "Hello", body_text: "Body" },
  }),
  false
);
assert.equal(
  needsOvernightOutreachPreparation({
    ...base,
    status: "drafted",
    researched_at: "2026-08-31T05:20:00Z",
    research: { summary: "Verified" },
    message: {
      status: "draft",
      subject: "Hello",
      body_text: "Body",
      voice_script: "Spoken draft",
    },
  }),
  false
);
assert.equal(
  needsOvernightOutreachPreparation({
    ...base,
    status: "drafted",
    researched_at: "2026-08-31T05:20:00Z",
    research: { summary: "Verified" },
    message: {
      status: "draft",
      subject: "Hello",
      body_text: "Body",
      voice_script: "",
    },
  }),
  true
);

assert.deepEqual(
  roundRobinPreparationJobs(
    [
      ["a1", "a2", "a3"],
      ["b1", "b2"],
      ["c1"],
    ],
    5
  ),
  ["a1", "b1", "c1", "a2", "b2"]
);

const cron = read("app/api/cron/outreach-queue/route.ts");
const prepare = read("app/api/crm/outreach/[id]/prepare/route.ts");
const vercel = JSON.parse(read("vercel.json"));

assert.match(cron, /listActiveAccountScopes\(\{ connectedOnly: true \}\)/);
assert.match(cron, /prepareOutreach/);
assert.match(cron, /generationMode: "overnight"/);
assert.match(cron, /roundRobinPreparationJobs/);
assert.match(cron, /MAX_PER_ACCOUNT = 8/);
assert.match(cron, /PREPARATION_CONCURRENCY = 6/);
assert.doesNotMatch(cron, /\/send["`]/);
assert.doesNotMatch(cron, /generateOutreachVoiceNote|ElevenLabs/);
assert.doesNotMatch(cron, /status:\s*"approved"/);

assert.match(prepare, /generationMode === "overnight"/);
assert.match(prepare, /generationMode,/);

assert(
  vercel.crons.some(
    (cron) =>
      cron.path === "/api/cron/outreach-queue" &&
      cron.schedule === "20 5,6,7 * * *"
  ),
  "Outreach preparation must receive three early-morning recovery passes"
);

console.log("Overnight outreach preparation checks passed");
