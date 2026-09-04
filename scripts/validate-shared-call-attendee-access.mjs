import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260904170105_shared_call_attendee_access.sql"
);
const helper = read("lib/shared-call-access.ts");
const start = read("app/api/meet/start/route.ts");
const upcoming = read("app/api/crm/upcoming/[id]/route.ts");
const call = read("app/api/crm/calls/[id]/route.ts");
const calls = read("app/api/crm/calls/route.ts");
const transcript = read("app/api/crm/calls/[id]/transcript/route.ts");
const brainTranscript = read("lib/call-transcript-context.ts");
const summary = read("app/api/interview/summary/route.ts");
const sessionEnd = read("app/api/interview/session-end/route.ts");
const microsoft = read("lib/microsoft.ts");

// Persistent read access is distinct from an active coaching subscription and
// remains private to one exact user and workspace.
assert.match(migration, /create table if not exists public\.meet_capture_access/i);
assert.match(migration, /unique \(capture_id, user_id\)/i);
assert.match(migration, /user_id = \(select auth\.uid\(\)\)/i);
assert.match(migration, /wm\.status = 'active'/i);
assert.match(migration, /revoke all on public\.meet_capture_access from public, anon, authenticated/i);
assert.match(migration, /host_owner_id/i);
assert.match(migration, /canonical_upcoming_id/i);

// URL knowledge is insufficient. The resolver begins with an owned calendar
// row, then requires the same provider id, normalised URL, scheduled minute and
// a workspace-member email that is present on the attendee list.
assert.match(start, /\.eq\("owner_id", accountScope\.userId\)/);
assert.match(start, /resolveSharedCalendarOccurrence/);
assert.match(helper, /\.eq\("external_id", requested\.external_id\)/);
assert.match(helper, /meetingInstanceKey\(row\.meeting_url, row\.scheduled_at\) === instanceKey/);
assert.match(helper, /invitedEmails\.has\(email\)/);
assert.match(helper, /\.eq\("status", "active"\)/);
assert.match(helper, /grantSharedCaptureAccess/);
assert.match(start, /host_owner_id: sharedOccurrence\.hostOwnerId/);
assert.match(start, /canonical_upcoming_id: sharedOccurrence\.canonical\.id/);

// The organiser's safe focus and one canonical transcript are visible to
// verified attendees. Research and private notes are not copied from the host.
assert.match(upcoming, /sharedFocusPrep\(occurrence\.canonical\.prep\)/);
assert.match(upcoming, /ownPrep\.privateNotes/);
assert.doesNotMatch(helper.match(/export function sharedFocusPrep[\s\S]*$/)?.[0] || "", /"research"/);
assert.match(call, /loadSharedCallAccess/);
assert.match(calls, /meet_capture_access/);
assert.match(transcript, /loadSharedCallAccess/);
assert.match(brainTranscript, /meet_capture_access/);
assert.match(brainTranscript, /sharedCaptureBySession/);
assert.match(summary, /loadHostIdentityForUser/);
assert.match(summary, /HOST NAME:/);
assert.match(sessionEnd, /completeSharedUpcomingCalls/);

// Outlook snapshots must retain organiser identity just as Google snapshots do.
assert.match(microsoft, /organizer: Boolean\(email && email === organiserAddress\)/);

console.log("Shared call organiser, attendee access and transcript checks passed");
