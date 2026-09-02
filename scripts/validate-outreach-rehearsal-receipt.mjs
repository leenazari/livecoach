import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const route = read("app/api/crm/outreach/messages/[id]/rehearse/route.ts");
const page = read("app/crm/outreach/page.tsx");
const today = read("components/crm/OutreachTodayLane.tsx");

assert.match(route, /\.eq\("workspace_id", sender\.workspaceId\)/);
assert.match(route, /\.eq\("sender_user_id", sender\.userId\)/);
assert.match(route, /to: sender\.mailboxEmail/);
assert.match(route, /provider: sender\.provider/);
assert.match(route, /accepted: true/);
assert.match(route, /deliveryLocation/);
assert.match(route, /const voiceNoteIncluded = Boolean/);
assert.match(route, /message\.voice_status === "ready" && !voiceNoteIncluded/);
assert.match(route, /voiceNote: \{/);
assert.match(route, /url: outreachVoicePublicUrl\(message\.voice_public_token\)/);
assert.match(route, /voice_note_included: voiceNoteIncluded/);
assert.match(route, /voiceIncluded: voiceNoteIncluded/);
assert.match(route, /outreach_rehearsal_accepted/);
assert.match(route, /campaignChanged: false/);
assert.match(page, /!result\.accepted/);
assert.match(page, /Gmail accepted the rehearsal/);
assert.match(page, /result\.voiceIncluded \? "The ready voice note is included\."/);
assert.match(today, /result\.voiceIncluded \? "The ready voice note is included\."/);
assert.match(page, /look in Sent or All Mail/);
assert.match(page, /may not create a new Inbox message/);
assert.match(page, /No prospect was contacted and campaign results did not change/);

console.log("Outreach rehearsal delivery receipt validation passed.");
