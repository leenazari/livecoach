import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validMeetingUrl } from "../lib/meeting-url.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

assert.equal(
  validMeetingUrl("https://teams.microsoft.com/l/meetup-join/example"),
  true
);
assert.equal(validMeetingUrl("https://meet.google.com/abc-defg-hij"), true);
assert.equal(validMeetingUrl("https://company.zoom.us/j/123456789"), true);
assert.equal(validMeetingUrl("http://teams.microsoft.com/l/meetup-join/x"), false);
assert.equal(validMeetingUrl("https://teams.microsoft.com.evil.example/x"), false);
assert.equal(validMeetingUrl("https://example.com/meeting"), false);

const launch = read("lib/call-launch.ts");
const upcoming = read("components/crm/UpcomingCalls.tsx");
const prep = read("app/crm/prep/page.tsx");
const call = read("app/call/page.tsx");
const meetStage = read("components/MeetStage.tsx");
const startRoute = read("app/api/meet/start/route.ts");

// An auto-start is authorised by a fresh browser-session marker tied to the
// exact scheduled call and link, never by a copied query string alone.
assert.match(launch, /MAX_AGE_MS = 2 \* 60 \* 1000/);
assert.match(launch, /sessionStorage\.setItem/);
assert.match(launch, /sessionStorage\.removeItem/);
assert.match(launch, /pending\.upcomingId === upcomingId\.trim\(\)/);
assert.match(launch, /pending\.meetingUrl === meetingUrl\.trim\(\)/);
assert.match(launch, /window\.open\(cleanUrl, "_blank", "noopener,noreferrer"\)/);

// The dashboard opens the meeting inside the direct click and carries the
// one-use launch marker into the same scheduled call.
assert.match(upcoming, /openAndArmCallLaunch/);
assert.match(upcoming, /qs\.set\("launch", "1"\)/);
assert.match(upcoming, /qs\.set\("upcoming"/);
assert.match(upcoming, /Add a supported Teams, Meet or Zoom link before starting/);

// Old prep links remain safe, but preparation itself now lives in /call.
assert.match(prep, /redirect\(`\/call/);
assert.match(prep, /Object\.entries\(searchParams \|\| \{\}\)/);
assert.doesNotMatch(prep, /openAndArmCallLaunch|\/api\/interview\/plan/);

// /call consumes and removes the one-use flag, then starts the session and bot.
// Manual starts open the provider directly before goLive.
assert.match(call, /consumeArmedCallLaunch\(upcoming, url\)/);
assert.match(call, /p\.delete\("launch"\)/);
assert.match(call, /window\.history\.replaceState/);
assert.match(call, /const openMeetingAndGoLive = useCallback/);
assert.match(call, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
assert.match(call, /openMeetingAndGoLive/);
assert.match(call, /Open meeting \+ start/);
assert.match(call, /autoLaunchHandledRef\.current = true/);
assert.match(call, /else openMeetingAndGoLive\(\)/);
assert.match(call, /setBotStartRequest\(\(request\) => request \+ 1\)/);

// Existing per-user and double-click guards remain in the cost-bearing path.
assert.match(meetStage, /sendingRef\.current/);
assert.match(meetStage, /botIdRef\.current/);
assert.match(startRoute, /\.eq\("owner_id", accountScope\.userId\)/);
assert.match(startRoute, /transcriber_already_active/);

console.log("One-click meeting and LiveCoach launch checks passed");
