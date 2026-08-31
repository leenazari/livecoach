import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  needsNewOvernightOutreachResearch,
  needsOvernightOutreachPreparation,
  needsOnlyOvernightVoiceScript,
  OVERNIGHT_RESEARCH_INVENTORY_LIMIT,
  roundRobinPreparationJobs,
  selectOvernightOutreachPreparation,
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
assert.equal(OVERNIGHT_RESEARCH_INVENTORY_LIMIT, 20);
assert.equal(needsNewOvernightOutreachResearch(base), true);
assert.equal(
  needsOnlyOvernightVoiceScript({
    ...base,
    message: {
      id: "message-1",
      status: "draft",
      subject: "Hello",
      body_text: "Body",
      voice_script: "",
    },
  }),
  true
);

const freshRows = Array.from({ length: 30 }, (_, index) => ({
  ...base,
  id: `enrolment-${index + 1}`,
  prospect: { id: `prospect-${index + 1}` },
}));
const firstPass = selectOvernightOutreachPreparation(freshRows, {
  outstandingResearch: 0,
  maxAttempts: 8,
});
assert.equal(firstPass.candidates.length, 8);
assert.equal(firstPass.newResearchPlanned, 8);
assert.equal(firstPass.researchLimit, 20);
assert.equal(firstPass.deferredByResearchCap, 10);

const secondPass = selectOvernightOutreachPreparation(freshRows.slice(8), {
  outstandingResearch: 8,
  maxAttempts: 8,
});
assert.equal(secondPass.candidates.length, 8);
assert.equal(secondPass.newResearchPlanned, 8);

const thirdPass = selectOvernightOutreachPreparation(freshRows.slice(16), {
  outstandingResearch: 16,
  maxAttempts: 8,
});
assert.equal(thirdPass.candidates.length, 4);
assert.equal(thirdPass.newResearchPlanned, 4);
assert.equal(thirdPass.deferredByResearchCap, 10);

const cappedPass = selectOvernightOutreachPreparation(
  [
    {
      ...base,
      id: "researched-recovery",
      researched_at: "2026-08-31T05:20:00Z",
      research: { summary: "Verified" },
      message: {
        id: "message-recovery",
        status: "draft",
        subject: "",
        body_text: "",
        voice_script: "",
      },
    },
    {
      ...base,
      id: "voice-recovery",
      message: {
        id: "message-voice",
        status: "draft",
        subject: "Hello",
        body_text: "Body",
        voice_script: "",
      },
    },
    freshRows[20],
    freshRows[21],
  ],
  {
    outstandingResearch: 20,
    maxAttempts: 8,
  }
);
assert.deepEqual(
  cappedPass.candidates.map((row) => row.id),
  ["researched-recovery", "voice-recovery"]
);
assert.equal(cappedPass.newResearchPlanned, 0);
assert.equal(cappedPass.deferredByResearchCap, 2);

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
const outreachPage = read("app/crm/outreach/page.tsx");
const vercel = JSON.parse(read("vercel.json"));

assert.match(cron, /listActiveAccountScopes\(\{ connectedOnly: true \}\)/);
assert.match(cron, /prepareOutreach/);
assert.match(cron, /createOutreachVoiceScript/);
assert.match(cron, /needsOnlyVoiceScript/);
assert.match(cron, /preparationType: needsOnlyVoiceScript/);
assert.match(cron, /generationMode: "overnight"/);
assert.match(cron, /roundRobinPreparationJobs/);
assert.match(cron, /MAX_PER_ACCOUNT = 8/);
assert.match(cron, /OVERNIGHT_RESEARCH_INVENTORY_LIMIT/);
assert.match(cron, /\.eq\("owner_id", account\.userId\)/);
assert.match(cron, /\.not\("researched_at", "is", null\)/);
assert.match(cron, /deferredByResearchCap/);
assert.match(cron, /PREPARATION_CONCURRENCY = 6/);
assert.doesNotMatch(cron, /\/send["`]/);
assert.doesNotMatch(cron, /generateOutreachVoiceNote|ElevenLabs/);
assert.doesNotMatch(cron, /status:\s*"approved"/);

assert.match(prepare, /generationMode === "overnight"/);
assert.match(prepare, /generationMode,/);
assert.match(outreachPage, /maximum of \{OVERNIGHT_RESEARCH_INVENTORY_LIMIT\} unused researched leads per salesperson/);

assert(
  vercel.crons.some(
    (cron) =>
      cron.path === "/api/cron/outreach-queue" &&
      cron.schedule === "20 5,6,7 * * *"
  ),
  "Outreach preparation must receive three early-morning recovery passes"
);

console.log("Overnight outreach preparation checks passed");
