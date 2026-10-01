import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { currentRecallBotState } from "../lib/recall-bot-status.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const joining = currentRecallBotState({
  status_changes: [
    {
      code: "joining_call",
      created_at: "2026-10-01T08:59:33.000Z",
    },
  ],
});
assert.equal(joining.phase, "joining");
assert.equal(joining.terminal, false);
assert.match(joining.message, /not reached the meeting/i);

const waiting = currentRecallBotState({
  status_changes: [
    {
      code: "bot.in_waiting_room",
      created_at: "2026-10-01T08:59:40.000Z",
    },
  ],
});
assert.equal(waiting.phase, "waiting_room");
assert.match(waiting.message, /needs to be admitted/i);

const recording = currentRecallBotState({
  status_changes: [
    {
      code: "in_call_not_recording",
      created_at: "2026-10-01T08:59:45.000Z",
    },
    {
      code: "in_call_recording",
      created_at: "2026-10-01T08:59:47.000Z",
    },
  ],
});
assert.equal(recording.phase, "recording");
assert.equal(recording.recording, true);
assert.equal(recording.joined, true);

const blockedThenDone = currentRecallBotState({
  status_changes: [
    {
      code: "joining_call",
      created_at: "2026-10-01T08:59:33.000Z",
    },
    {
      code: "fatal",
      sub_code: "google_meet_bot_blocked",
      created_at: "2026-10-01T08:59:42.000Z",
    },
    {
      code: "done",
      created_at: "2026-10-01T08:59:44.000Z",
    },
  ],
});
assert.equal(blockedThenDone.phase, "failed");
assert.equal(blockedThenDone.terminal, true);
assert.equal(blockedThenDone.subCode, "google_meet_bot_blocked");
assert.equal(blockedThenDone.joined, false);
assert.match(blockedThenDone.message, /before it reached the waiting room/i);

const endedThenDone = currentRecallBotState({
  status_changes: [
    {
      code: "in_call_recording",
      created_at: "2026-10-01T09:00:00.000Z",
    },
    {
      code: "call_ended",
      sub_code: "host_ended_meeting",
      created_at: "2026-10-01T09:30:00.000Z",
    },
    {
      code: "done",
      created_at: "2026-10-01T09:30:02.000Z",
    },
  ],
});
assert.equal(endedThenDone.phase, "ended");
assert.equal(endedThenDone.joined, true);
assert.match(endedThenDone.message, /host ended/i);

const kicked = currentRecallBotState({
  status_changes: [
    {
      code: "call_ended",
      sub_code: "bot_kicked_from_call",
      created_at: "2026-10-01T09:30:00.000Z",
    },
  ],
});
assert.equal(kicked.subCode, "bot_kicked_from_call");
assert.match(kicked.message, /removed from the meeting/i);

const [route, stage] = await Promise.all([
  read("app/api/meet/status/route.ts"),
  read("components/MeetStage.tsx"),
]);

assert.match(route, /resolveRecordScope\(\)/);
assert.match(route, /validMeetSessionId\(sessionId\)/);
assert.match(route, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(route, /\.eq\("owner_id", scope\.userId\)/);
assert.match(route, /\.eq\("session_id", sessionId\)/);
assert.match(route, /currentRecallBotState/);
assert.match(route, /"Cache-Control": "private, no-store"/);
assert.doesNotMatch(route, /searchParams\.get\("bot/i);
assert.doesNotMatch(route, /meeting_url/);

assert.match(stage, /\/api\/meet\/status/);
assert.match(stage, /next\.phase === "waiting_room"/);
assert.match(stage, /providerState\.subCode/);
assert.match(stage, /It is not necessarily in the waiting room/);
assert.doesNotMatch(stage, /almost always it's waiting in the lobby/i);

console.log("Recall provider lifecycle validation passed");
