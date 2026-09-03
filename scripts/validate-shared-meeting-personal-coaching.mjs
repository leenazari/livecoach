import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [start, access, backfill, session, stage, limits, supabase, teamPage] =
  await Promise.all([
    read("app/api/meet/start/route.ts"),
    read("app/api/meet/access/route.ts"),
    read("app/api/meet/backfill/route.ts"),
    read("app/api/interview/session/route.ts"),
    read("components/MeetStage.tsx"),
    read("supabase/migrations/20260821183209_transcriber_cost_controls.sql"),
    read("lib/supabase.ts"),
    read("app/settings/team/page.tsx"),
  ]);

// The active-bot guard is personal. A bot owned by another teammate in the
// same workspace and meeting must never block this user from starting theirs.
const activeBotLookup =
  start.match(
    /const \{ data: activeBotRows[\s\S]*?if \(existingError\) throw existingError;/
  )?.[0] || "";
assert.match(activeBotLookup, /\.eq\("workspace_id", accountScope\.workspaceId\)/);
assert.match(activeBotLookup, /\.eq\("owner_id", accountScope\.userId\)/);
assert.match(activeBotLookup, /\.eq\("status", "active"\)/);
assert.doesNotMatch(activeBotLookup, /meeting_url|meetingUrl/);

// The database ceiling is also per owner, not per workspace or meeting URL.
assert.match(
  limits,
  /meet_bots_one_active_per_owner_uidx[\s\S]*?\(workspace_id, owner_id\)[\s\S]*?where status = 'active'/i
);
assert.doesNotMatch(limits, /unique[\s\S]{0,120}meeting_url/i);

// Each bot and browser stream carries the exact owner, workspace and private
// session identity. Two coaches hearing the same conversation therefore feed
// two separate LiveCoach rooms and two separate coaching agendas.
assert.match(start, /metadata:\s*\{[\s\S]*session_id: sessionId,[\s\S]*owner_id: accountScope\.userId,[\s\S]*workspace_id: accountScope\.workspaceId/);
assert.match(start, /\.insert\(\{[\s\S]*session_id: String\(sessionId\),[\s\S]*\.\.\.privateRecordFields\(accountScope\)/);
assert.match(access, /workspace_id: scope\.workspaceId/);
assert.match(access, /owner_id: scope\.userId/);
assert.match(access, /session_id: sessionId/);
assert.match(backfill, /\.eq\("workspace_id", accountScope\.workspaceId\)/);
assert.match(backfill, /\.eq\("owner_id", accountScope\.userId\)/);
assert.match(backfill, /\.eq\("session_id", session\)/);
assert.match(session, /\.\.\.privateRecordFields\(accountScope\)/);
assert.match(session, /onConflict: "owner_id,session_id"/);

// Personal aliases decide who is being coached in each browser. The generic
// database proxy keeps all call and transcript tables behind user RLS.
assert.match(stage, /coachHintsRef/);
for (const table of [
  "interview_sessions",
  "interview_summaries",
  "meet_bots",
  "meet_utterances",
]) {
  assert.match(supabase, new RegExp(`"${table}"`));
}
assert.match(teamPage, /Teammates can each use their own private notetaker in the same meeting/);

console.log("Shared-meeting personal coaching validation passed");
