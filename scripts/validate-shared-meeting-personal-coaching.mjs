import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  migration,
  calendarLinkIndexes,
  start,
  stop,
  access,
  backfill,
  session,
  sessionEnd,
  summary,
  suggest,
  runningSummary,
  insight,
  stage,
  callPage,
  supabase,
  teamPage,
] = await Promise.all([
  read("supabase/migrations/20260903165256_shared_meeting_capture_fanout.sql"),
  read("supabase/migrations/20260903171800_index_shared_meeting_calendar_links.sql"),
  read("app/api/meet/start/route.ts"),
  read("app/api/meet/stop/route.ts"),
  read("app/api/meet/access/route.ts"),
  read("app/api/meet/backfill/route.ts"),
  read("app/api/interview/session/route.ts"),
  read("app/api/interview/session-end/route.ts"),
  read("app/api/interview/summary/route.ts"),
  read("app/api/interview/suggest/route.ts"),
  read("app/api/interview/running-summary/route.ts"),
  read("app/api/interview/insight/route.ts"),
  read("components/MeetStage.tsx"),
  read("app/call/page.tsx"),
  read("lib/supabase.ts"),
  read("app/settings/team/page.tsx"),
]);

// One provider capture is unique to a verified meeting occurrence. Each user
// gets one private subscription rather than another Recall bot.
assert.match(migration, /create table if not exists public\.meet_capture_subscribers/i);
assert.match(migration, /meet_bots_one_active_instance_uidx[\s\S]*?workspace_id, meeting_instance_key/i);
assert.match(migration, /meet_capture_subscribers_one_active_owner_uidx[\s\S]*?workspace_id, owner_id/i);
assert.match(migration, /drop index if exists public\.meet_bots_one_active_per_owner_uidx/i);
assert.match(migration, /visibility text not null default 'private'/i);
assert.match(migration, /owner_id = \(select auth\.uid\(\)\)/i);
assert.match(migration, /seed_meet_capture_owner_subscription/i);
assert.match(migration, /not exists \([\s\S]*?active_subscriber[\s\S]*?status = 'active'/i);
assert.match(calendarLinkIndexes, /meet_bots_source_upcoming_idx/i);
assert.match(calendarLinkIndexes, /meet_capture_subscribers_upcoming_idx/i);

// A browser cannot join a shared capture from a URL alone. The signed-in user
// must own an exact Google or Microsoft upcoming-call occurrence whose URL and
// scheduled minute produce the same server-generated key.
assert.match(start, /\.from\("upcoming_calls"\)[\s\S]*?\.eq\("owner_id", accountScope\.userId\)/);
assert.match(start, /shareableCalendarSource\(call\.source, call\.external_id\)/);
assert.match(start, /meetingUrlsMatch\(call\.meeting_url, meetingUrl\)/);
assert.match(start, /meetingInstanceKey\([\s\S]*?call\.scheduled_at/);
assert.match(start, /\.eq\("meeting_instance_key", sharedInstanceKey\)/);
assert.match(start, /attachSubscriber\([\s\S]*?ownerId: accountScope\.userId[\s\S]*?sessionId/);
assert.match(start, /status: "shared_active"/);
assert.match(start, /captureBotName = sharedInstanceKey[\s\S]*?"LiveCoach Notetaker"/);
assert.match(start, /\.\.\.privateRecordFields\(accountScope\)/);

// Stopping or summarising detaches only one private subscriber. Recall leaves
// only after the final active subscriber is gone.
assert.match(stop, /\.from\("meet_capture_subscribers"\)[\s\S]*?\.eq\("owner_id", accountScope\.userId\)/);
assert.match(stop, /\.select\("id", \{ count: "exact", head: true \}\)/);
assert.match(stop, /if \(\(count \|\| 0\) > 0\)[\s\S]*?continue/);
assert.match(stop, /await leave\(capture\.bot_id\)/);
assert.match(sessionEnd, /\.from\("meet_capture_subscribers"\)/);
assert.match(migration, /create or replace function public\.close_meet_bots_on_summary\(\)/i);

// The raw utterance is stored once. Backfill is authorised through the user's
// own subscription, then resolves the canonical bot without exposing it as a
// team-visible record.
assert.match(backfill, /\.from\("meet_capture_subscribers"\)[\s\S]*?\.eq\("owner_id", accountScope\.userId\)[\s\S]*?\.eq\("session_id", session\)/);
assert.match(backfill, /\.from\("meet_bots"\)[\s\S]*?\.eq\("id", subscription\.capture_id\)/);
assert.match(backfill, /\.from\("meet_utterances"\)[\s\S]*?\.eq\("bot_id", capture\.bot_id\)/);

// Browser rooms, coaching sessions and summaries remain account-private. A
// teammate is labelled separately so their speech is never assessed as the
// buyer or candidate in either user's summary.
assert.match(access, /workspace_id: scope\.workspaceId/);
assert.match(access, /owner_id: scope\.userId/);
assert.match(access, /teamHints/);
assert.match(session, /\.\.\.privateRecordFields\(accountScope\)/);
assert.match(session, /onConflict: "owner_id,session_id"/);
assert.match(stage, /upcomingId\?: string \| null/);
assert.match(stage, /JSON\.stringify\(\{[\s\S]*?meetingUrl: meetingUrl\.trim\(\),[\s\S]*?sessionId: room,[\s\S]*?upcomingId/);
assert.match(stage, /return "teammate"/);
assert.match(stage, /if \(d\.sharedCapture\) void deliverBackfill\(0\)/);
assert.match(callPage, /upcomingId=\{upcomingId\}/);
assert.match(callPage, /Team member/);
assert.match(summary, /SHARED TEAM CALLS: a label beginning "Team member/);
assert.match(suggest, /A label beginning "Team member" is an INTERNAL colleague/);
assert.match(runningSummary, /A speaker label beginning "Team member" means an internal colleague/);
assert.match(insight, /A speaker label beginning "Team member" identifies an internal colleague/);
assert.match(supabase, /"meet_capture_subscribers"/);
assert.match(teamPage, /one notetaker can securely serve teammates on the same scheduled meeting/i);

console.log("Shared meeting capture and private coaching validation passed");
