import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const lane = read("components/crm/OutreachTodayLane.tsx");
const queue = read("app/api/crm/outreach/queue/route.ts");
const send = read("lib/outreach-send-queue.ts");
const rehearsal = read("app/api/crm/outreach/messages/[id]/rehearse/route.ts");

// The default Sales Desk presents one next action, while retaining an explicit
// full-queue escape hatch and a compact preview of what comes next.
assert.match(lane, /Step one first/);
assert.match(lane, /const rowsToRender = showFullQueue[\s\S]*?focusedRow[\s\S]*?\[focusedRow\]/);
assert.match(lane, /Do this next/);
assert.match(lane, /Keep moving without leaving this screen/);
assert.match(lane, /View full queue/);

// Step one rows outrank follow ups. Within the active wave, reviewable drafts
// outrank new research, and approval clears the explicit focus so the next
// actionable row becomes current after the canonical reload.
assert.match(lane, /queueWaveRank\(a\.row\) - queueWaveRank\(b\.row\)/);
assert.match(lane, /\["draft", "failed"\]\.includes\(row\.message\.status\)\) return 0/);
assert.match(lane, /!row\.message && row\.status === "queued"\) return 2/);
assert.match(lane, /setFocusedRowId\(""\)[\s\S]*?await load\(true\)/);
assert.match(lane, /Later this session/);
assert.match(lane, /Nothing was deleted or changed/);

// Research still runs at most two at a time and never blocks the rest of the
// CRM. Exact wording must still be approved before entering the send queue.
assert.match(lane, /const MAX_CONCURRENT_RESEARCH = 2/);
assert.match(lane, /The rest of the CRM remains usable/);
assert.match(lane, /status: "approved"/);
assert.match(lane, /\/api\/crm\/outreach\/messages\/\$\{message\.id\}\/send/);
assert.match(send, /OUTREACH_SEND_SPACING_MINUTES = 5/);

// The optional rehearsal stays self-addressed, campaign-neutral and scoped to
// the signed-in user's connected identity.
assert.match(lane, /Send test to me/);
assert.match(lane, /result\.campaignChanged !== false/);
assert.match(rehearsal, /to: sender\.mailboxEmail/);
assert.match(rehearsal, /\.eq\("workspace_id", sender\.workspaceId\)/);
assert.match(rehearsal, /\.eq\("sender_user_id", sender\.userId\)/);
assert.match(rehearsal, /campaignChanged: false/);

// Queue reads remain owner-specific and preserve the existing mobile layout.
assert.match(queue, /assigned_to_user_id === userId/);
assert.match(lane, /sm:grid-cols-2/);
assert.match(lane, /lg:grid-cols-\[minmax\(0,1\.2fr\)_minmax\(17rem,0\.8fr\)\]/);

console.log("Focused outreach Sales Desk checks passed");
