import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectOutOfOffice } from "../lib/email-reply-signals.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

assert.deepEqual(
  detectOutOfOffice({
    subject: "Automatic reply: Partnership follow up",
    freshText: "I am out of the office and returning on 2 September 2026.",
    receivedAt: "2026-08-28T09:00:00Z",
  }),
  {
    isOutOfOffice: true,
    returnDate: "2026-09-02",
    summary: "Out of office until 02 Sept 2026.",
  }
);

assert.equal(
  detectOutOfOffice({
    freshText: "I am currently away and back on Monday.",
    receivedAt: "2026-08-28T12:00:00Z",
  }).returnDate,
  "2026-08-31"
);

assert.equal(
  detectOutOfOffice({
    freshText: "I am on annual leave until 04/09/2026.",
    receivedAt: "2026-08-28T12:00:00Z",
  }).returnDate,
  "2026-09-04"
);

assert.deepEqual(
  detectOutOfOffice({
    subject: "Re: Interviewa",
    freshText: "Thanks Lee. Tuesday works for the demo.",
    receivedAt: "2026-08-28T12:00:00Z",
  }),
  { isOutOfOffice: false, returnDate: null, summary: "" }
);

const migration = read(
  "supabase/migrations/20260828142225_client_email_reply_activity.sql"
);
const kindMigration = read(
  "supabase/migrations/20260831135749_allow_client_email_reply_context.sql"
);
const activity = read("lib/client-email-activity.ts");
const monitor = read("app/api/cron/important-email-monitor/route.ts");
const outreach = read("lib/outreach-replies.ts");
const timeline = read("app/api/crm/companies/[id]/timeline/route.ts");
const commercialMemory = read("lib/commercial-memory.ts");
const brainContext = read("lib/crm-context.ts");

// The canonical activity row carries a stable provider message identity. Both
// the hourly monitor and daily safety sweep can retry without duplicating it.
assert.match(migration, /add column if not exists source_ref text/);
assert.match(migration, /add column if not exists metadata jsonb/);
assert.match(migration, /unique index[\s\S]*?\(owner_id, source_ref\)/);
assert.match(kindMigration, /drop constraint if exists client_context_kind_check/);
assert.match(
  kindMigration,
  /check \(kind in \('note', 'link', 'doc', 'email_reply'\)\)/
);
assert.match(activity, /onConflict: "owner_id,source_ref"/);
assert.match(activity, /ignoreDuplicates: true/);
assert.match(activity, /kind: "email_reply"/);
assert.match(activity, /created_at: receivedAt/);
assert.match(activity, /returnDate: outOfOffice\.returnDate/);
assert.match(activity, /visibility: "private"/);
assert.match(activity, /const ambiguous = companyIds\.size > 1 \|\| contacts\.length > 1 \|\| prospects\.length > 1/);

// Every connector account keeps its own delta cursor and only the fresh body
// is fetched. OOO replies are deterministic and never consume an AI pass.
assert.match(monitor, /listActiveAccountScopes\(\{ connectedOnly: true \}\)/);
assert.match(monitor, /runWithServiceRecordScope/);
assert.match(monitor, /newInboxMessagesSince/);
assert.match(monitor, /freshMessageText\(message\.id, 5000\)/);
assert.match(monitor, /recordClientEmailActivity/);
assert.match(monitor, /processOutreachReplyMessage/);
const outreachStopIndex = monitor.indexOf(
  "const outreach = await processOutreachReplyMessage"
);
const clientActivityIndex = monitor.indexOf(
  "const activity = await recordClientEmailActivity"
);
assert(outreachStopIndex >= 0);
assert(clientActivityIndex >= 0);
assert(
  outreachStopIndex < clientActivityIndex,
  "Outreach reply processing must run before client timeline logging"
);
assert.match(monitor, /if \(outOfOffice\.isOutOfOffice\)[\s\S]*?continue/);
assert.match(monitor, /ambiguousSenderMatches/);

// Outreach attribution additionally requires an earlier sent message from the
// same signed-in salesperson. This prevents cross-user reply metrics.
assert.match(outreach, /\.eq\("sender_user_id", input\.sender\.userId\)/);
assert.match(outreach, /receivedMs <= sentMs/);
assert.match(outreach, /reply_type: outOfOffice\.isOutOfOffice \? "out_of_office" : "reply"/);
assert.match(outreach, /return_date: outOfOffice\.returnDate/);
assert.match(outreach, /last_reply_text: `\$\{input\.message\.subject\}\\n\$\{input\.freshText \|\| input\.message\.snippet\}`/);

// The same stored record is visible in the relationship timeline and loaded
// into the Brain's existing client context rather than copied elsewhere.
assert.match(timeline, /emailReply \? "email" : "note"/);
assert.match(timeline, /metadata\.replyType === "out_of_office"/);
assert.match(timeline, /validReturnDate \? `back \$\{validReturnDate\}`/);
assert.match(commercialMemory, /row\.metadata\?\.returnDate/);
assert.match(brainContext, /c\.metadata\?\.returnDate \? `return date/);

console.log("Client email reply activity checks passed");
