import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server.js";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function compile(file, deps = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function("require", "module", "exports", code)(name => {
    if (name in deps) return deps[name];
    if (name === "server-only" || name.startsWith("@/")) return {};
    return require(name);
  }, module, module.exports);
  return module.exports;
}
const id = n => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const alice = id(1), bob = id(2), tenant = id(3), otherTenant = id(4), notificationId = id(5), taskId = id(6), companyId = id(7);
const owner = { userId: alice, workspaceId: tenant, status: "active", role: "sales" };
let scope = owner;
const options = compile("lib/reply-meeting-options.ts");
const request = options.normaliseReplyMeetingRequest({ requested: true, durationMinutes: 30 });
const now = Date.parse("2026-10-23T16:00:00Z"); // Friday before UK clocks change.
const event = (start, end, extra = {}) => ({ start: { dateTime: start }, end: { dateTime: end }, ...extra });
const choose = (events = [], overrides = {}) => options.chooseReplyMeetingSlots({
  events, timezone: "Europe/London", workdayStart: "09:00", workdayEnd: "17:30",
  request, now, until: now + 7 * 86400_000, ...overrides,
});
let slots = choose([event("2026-10-26T09:00:00Z", "2026-10-26T10:00:00Z")]);
assert.equal(slots.length, 2);
assert.equal(slots[0].start, "2026-10-26T10:15:00.000Z", "London DST and 15-minute buffers");
assert.equal(slots[1].start, "2026-10-27T09:00:00.000Z", "Offer a useful choice of days");
assert.doesNotMatch(JSON.stringify(slots), /private investor/);
assert.equal(choose([{ start: { date: "2026-10-26" }, end: { date: "2026-10-27" }, summary: "private investor" }])[0].start, "2026-10-27T09:00:00.000Z");
for (const extra of [{ status: "cancelled" }, { transparency: "transparent" }, { attendees: [{ self: true, responseStatus: "declined" }] }]) {
  assert.equal(choose([event("2026-10-26T09:00:00Z", "2026-10-26T17:00:00Z", extra)])[0].start, "2026-10-26T09:00:00.000Z");
}
assert.throws(() => choose([{ start: { dateTime: "2026-10-26T09:00:00Z" } }]));
const afternoon = { ...request, fromDate: "2026-10-27", toDate: "2026-10-27", timeOfDay: "afternoon" };
slots = choose([], { request: afternoon });
assert.equal(slots[0].start, "2026-10-27T12:00:00.000Z");
assert.equal(slots[1].start, "2026-10-27T13:30:00.000Z");
assert.deepEqual(choose([event("2026-10-23T00:00:00Z", "2026-11-01T00:00:00Z")]), []);
assert.ok(options.normaliseReplyMeetingRequest({ requested: true, fromDate: "2026-02-30" }).clarification);
assert.ok(options.normaliseReplyMeetingRequest({ requested: true, durationMinutes: -10 }).clarification);
assert.ok(options.normaliseReplyMeetingRequest({ requested: true, weekdays: [0] }).clarification);
assert.equal(options.busyIntervals([{ start: { date: "2026-10-24" }, end: { date: "2026-10-25" }, calendar_timezone: "Europe/London" }], "UTC")[0].start, Date.parse("2026-10-23T23:00:00Z"));

const clock = Date.now;
Date.now = () => now;
const profile = { timezone: "Europe/London", workdayStart: "09:00", workdayEnd: "17:30", emailTone: "warm_direct", emailSignoff: "Alice", bookingUrl: "", personalContext: "" };
const calendarCalls = [];
let snapshot = { events: [], complete: true, failedCalendars: [], accountKeys: ["google:alice@example.test"] };
let calendarError = false;
const calendar = compile("lib/reply-calendar.ts", {
  "@/lib/reply-meeting-options": options,
  "@/lib/calendar-provider": { listConnectedCalendarAvailability: async (start, end, user) => {
    calendarCalls.push({ start, end, user });
    if (calendarError) throw new Error("Unavailable");
    return structuredClone(snapshot);
  } },
});
const verified = await calendar.suggestReplyMeetingOptions(owner, profile, request);
assert.equal(verified.status, "available");
assert.equal(verified.slots.length, 2);
const bodyWithTimes = options.insertMeetingOptions("Hello\n\n[[MEETING_OPTIONS]]\n\nAlice", verified);
assert.ok(bodyWithTimes.indexOf(verified.slots[0].label) < bodyWithTimes.indexOf("Alice"));
assert.doesNotMatch(bodyWithTimes, /MEETING_OPTIONS/);
await calendar.assertReplyMeetingOptionsCurrent(owner, verified, bodyWithTimes);
snapshot.events = [event(verified.slots[0].start, verified.slots[0].end)];
await assert.rejects(() => calendar.assertReplyMeetingOptionsCurrent(owner, verified, bodyWithTimes), { status: 409 });
snapshot.events = [];
snapshot.complete = false;
assert.equal((await calendar.suggestReplyMeetingOptions(owner, profile, request)).status, "unavailable");
await assert.rejects(() => calendar.assertReplyMeetingOptionsCurrent(owner, verified, bodyWithTimes), { status: 409 });
snapshot.complete = true;
snapshot.accountKeys = ["google:bob@example.test"];
await assert.rejects(() => calendar.assertReplyMeetingOptionsCurrent(owner, verified, bodyWithTimes), { status: 409 });
snapshot.accountKeys = verified.calendarAccountKeys;
calendarError = true;
assert.equal((await calendar.suggestReplyMeetingOptions(owner, profile, request)).slots.length, 0);
calendarError = false;
assert.equal((await calendar.suggestReplyMeetingOptions(owner, profile, { ...request, clarification: "Which Monday?" })).status, "clarify");
assert.ok(calendarCalls.every(call => call.user === alice));

// Both providers are exact-account reads, never preferred-provider fallback.
const providerOwners = [];
const providers = compile("lib/calendar-provider.ts", {
  "@/lib/google": {
    googleConnected: async user => { providerOwners.push(user); return { connected: true, email: `${user}@google.test` }; },
    getAccessToken: async (_force, user) => { providerOwners.push(user); return "test-token"; },
    listAllEventsSnapshot: async () => ({ events: [{ provider: "google" }], complete: true, failedCalendars: [] }),
  },
  "@/lib/microsoft": {
    microsoftConnected: async user => { providerOwners.push(user); return { connected: true, email: `${user}@microsoft.test` }; },
    listAllMicrosoftEventsSnapshot: async (_start, _end, user) => { providerOwners.push(user); return { events: [{ provider: "microsoft" }], complete: true, failedCalendars: [] }; },
  },
});
const both = await providers.listConnectedCalendarAvailability("start", "end", bob);
assert.deepEqual(both.events.map(e => e.provider), ["google", "microsoft"]);
assert.equal(both.accountKeys.length, 2);
assert.ok(providerOwners.every(user => user === bob));

const originalFetch = globalThis.fetch;
const google = compile("lib/google.ts");
const pages = [];
globalThis.fetch = async url => {
  const parsed = new URL(url); pages.push(parsed);
  return Response.json(parsed.searchParams.has("pageToken") ? { items: [{ id: "last-page-busy-event" }] } : { items: [{ id: "first" }], nextPageToken: "next" });
};
assert.equal((await google.listEvents("test", "start", "end")).length, 2);
assert.equal(pages[1].searchParams.get("pageToken"), "next");
globalThis.fetch = async () => Response.json({ items: [], nextPageToken: "loop" });
await assert.rejects(() => google.listEvents("test", "start", "end"), /pagination was incomplete/);
globalThis.fetch = originalFetch;

// Exercise real notification -> canonical task -> draft -> explicit send code.
const db = {
  crm_notifications: [{ id: notificationId, workspace_id: tenant, user_id: alice, kind: "important_email", source_event_key: "important_email:google:message", source_table: "companies", source_id: companyId, dismissed_at: null }],
  tasks: [{ id: taskId, workspace_id: tenant, owner_id: alice, company_id: companyId, text: "Reply to Ben", link_kind: "drafts", source: "important_email_monitor", source_ref: "google:message", status: "open", created_at: "2026-10-23T12:00:00Z", payload: { mailProvider: "google", mailMessageId: "message", mailThreadId: "thread", sender: "ben@example.test", senderHeader: "Ben <ben@example.test>", subject: "Catch up", receivedAt: "2026-10-23T12:00:00Z", action: "Arrange a catch-up", summary: "Ben asked for a catch-up" } }],
  email_assistant_drafts: [], contacts: [], outreach_suppressions: [], access_audit_events: [],
};
let failTable = "", modelCalls = 0, sends = 0;
const queries = [], writes = [];
const client = createClient("https://db.invalid", "test-only", { global: { fetch: async (input, init = {}) => {
  const url = new URL(String(input)), table = url.pathname.split("/").pop(), method = init.method || "GET";
  queries.push({ table, method, url });
  if (table === failTable) return Response.json({ code: "UNAVAILABLE", message: "Read failed" }, { status: 500 });
  const filtered = (db[table] || []).filter(row => [...url.searchParams].every(([key, val]) => {
    if (val.startsWith("eq.")) return String(row[key]) === val.slice(3);
    if (val.startsWith("in.(")) return val.slice(4, -1).split(",").includes(row[key]);
    if (val === "is.null") return row[key] == null;
    if (val === "not.is.null") return row[key] != null;
    return true;
  }));
  if (method === "GET") return Response.json(filtered.slice(0, Number(url.searchParams.get("limit")) || Infinity));
  const payload = JSON.parse(init.body); writes.push({ table, method, payload });
  if (method === "POST") {
    assert.equal(payload.workspace_id, tenant);
    assert.equal(payload.owner_id || payload.actor_user_id, alice);
    const row = { id: id(10 + writes.length), ...payload }; db[table].push(row); return Response.json([row]);
  }
  assert.equal(method, "PATCH");
  assert.equal(url.searchParams.get("workspace_id"), `eq.${tenant}`);
  assert.equal(url.searchParams.get(table === "crm_notifications" ? "user_id" : "owner_id"), `eq.${alice}`);
  for (const row of filtered) Object.assign(row, payload);
  return Response.json(filtered);
} } });
const source = { id: "message", threadId: "thread", date: "2026-10-23T12:00:00Z", from: "ben@example.test", snippet: "Could we catch up next week?" };
let thread = [source], denyClient = false;
const capabilities = { mailboxConnected: true, rehearsalReady: true, mailboxEmail: "alice@example.test", provider: "google", handoffReady: true };
const taskEmail = compile("lib/task-email.ts", {
  "@/lib/supabase": { supabaseService: client, supabaseAdmin: client },
  "@/lib/record-scope": { resolveRecordScope: async () => scope },
  "@/lib/assigned-client-access": { loadAssignedClientAccess: async (_id, current) => { assert.equal(current.userId, alice); return denyClient ? null : { mode: "owner", company: { id: companyId, name: "Ben's company" } }; } },
  "@/lib/email-assistant": {
    EMAIL_ASSISTANT_DRAFT_SELECT: "*", emailAssistantGroundedContext: async current => { assert.equal(current.userId, alice); return "Relevant private facts only"; },
    emailAssistantMeetingCtaRecommended: () => true, getEmailAssistantCapabilities: async () => capabilities,
    loadOwnedEmailAssistantDraft: async key => ({ scope, draft: db.email_assistant_drafts.find(row => row.id === key && row.owner_id === scope.userId && row.workspace_id === scope.workspaceId) }),
  },
  "@/lib/mail": {
    nameFromHeader: () => "Ben", freshMessageText: async (_id, _max, user) => { assert.equal(user, alice); return "Could we catch up next week?"; },
    connectedMailProvider: async user => { assert.equal(user, alice); return { provider: "google", email: "alice@example.test" }; },
    recentMessages: async (_query, _max, user) => { assert.equal(user, alice); return thread; },
    buildConnectedMailDraftContent: input => input,
    sendConnectedMail: async (message, user) => { assert.equal(user, alice); assert.equal(message.to, "ben@example.test"); assert.equal(message.sourceMessageId, "message"); sends++; return { ok: true, id: "sent-confirmation" }; },
  },
  "@/lib/sales-profile": { getSalesProfile: async () => profile },
  "@/lib/openai": { OPENAI_MODEL_PRO: "test", openai: { messages: { create: async input => {
    modelCalls++; assert.match(input.system, /NEVER write actual meeting dates/);
    assert.doesNotMatch(input.messages[0].content, /private investor/);
    return { content: [{ type: "text", text: JSON.stringify({ subject: "Re: Catch up", body: "Hello Ben\n\nHappy to catch up.\n\n[[MEETING_OPTIONS]]\n\nAlice", meeting: request }) }] };
  } } } },
  "@/lib/usage": { logModelUsage: async () => {} },
  "@/lib/outreach-demo-reply-cta": { deduplicateOutreachEmailSignoff: ({ body }) => body },
  "@/lib/reply-meeting-options": options, "@/lib/reply-calendar": calendar,
});
const notification = compile("lib/notification-email.ts", {
  "@/lib/request-scope": { requireRequestScope: () => scope }, "@/lib/supabase": { supabaseService: client },
  "@/lib/uuid": compile("lib/uuid.ts"), "@/lib/task-email": taskEmail,
});
const route = compile("app/api/crm/notifications/[id]/email/route.ts", {
  "@/lib/notification-email": notification, "@/lib/crm-blocker": compile("lib/crm-blocker.ts"),
});
const get = () => route.GET(new NextRequest(`https://crm.test/api/crm/notifications/${notificationId}/email`), { params: { id: notificationId } });
assert.equal((await get()).status, 200);
assert.equal(modelCalls, 0); assert.equal(writes.length, 0); assert.equal(sends, 0);
for (const changed of [{ userId: bob }, { workspaceId: otherTenant }, { status: "removed" }, { status: "suspended" }, { status: "onboarding" }]) {
  scope = { ...owner, ...changed };
  assert.ok([403, 404].includes((await get()).status), "Fail closed for another account, tenant or inactive membership");
}
scope = owner;
denyClient = true; assert.equal((await get()).status, 409); denyClient = false;
failTable = "tasks"; assert.equal((await get()).status, 500); failTable = "";
db.tasks.push({ ...db.tasks[0], id: id(99) }); assert.equal((await get()).status, 409); db.tasks.pop();
db.crm_notifications[0].source_id = id(100); assert.equal((await get()).status, 409); db.crm_notifications[0].source_id = companyId;
const post = body => route.POST(new NextRequest("https://crm.test/api/crm/notifications/x/email", { method: "POST", body: JSON.stringify(body) }), { params: { id: notificationId } });
assert.equal((await post({ intent: ["invalid"] })).status, 400);
assert.equal((await post(null)).status, 400);
thread = [{ ...source, threadId: "different-thread" }];
assert.equal((await post({})).status, 409); assert.equal(modelCalls, 0);
thread = [source, { ...source, id: "newer", date: "2026-10-23T13:00:00Z" }];
assert.equal((await post({})).status, 409); assert.equal(modelCalls, 0);
thread = [source];
const drafted = await post({ intent: "Suggest a catch-up", recipient_email: "wrong@example.test", ownerId: bob });
assert.equal(drafted.status, 200);
let draft = (await drafted.json()).draft;
assert.equal(modelCalls, 1); assert.equal(sends, 0);
assert.equal(draft.recipient_email, "ben@example.test"); assert.equal(draft.owner_id, alice);
assert.equal(draft.source_thread_id, "thread"); assert.equal(draft.source_task_id, taskId);
assert.equal(draft.meeting_options.slots.length, 2);
assert.equal(db.tasks[0].status, "open"); assert.equal(db.crm_notifications[0].dismissed_at, null);
db.email_assistant_drafts[0].recipient_email = "wrong@example.test";
assert.equal((await get()).status, 409, "A mismatched existing draft is never shown or sent");
db.email_assistant_drafts[0].recipient_email = "ben@example.test";
await get(); await post({}); assert.equal(modelCalls, 1, "Reload and repeated draft click reuse the canonical draft");
await post({ regenerate: true, intent: "Make it shorter" }); assert.equal(modelCalls, 2);
draft = db.email_assistant_drafts[0];
snapshot.events = [event(draft.meeting_options.slots[0].start, draft.meeting_options.slots[0].end)];
await assert.rejects(() => taskEmail.sendTaskEmailDraft(draft.id), { status: 409 });
assert.equal(sends, 0); assert.equal(draft.status, "draft");
snapshot.events = [];
scope = { ...owner, userId: bob };
await assert.rejects(() => taskEmail.sendTaskEmailDraft(draft.id), { status: 404 });
scope = owner;
assert.equal((await taskEmail.sendTaskEmailDraft(draft.id)).draft.status, "sent");
assert.equal(sends, 1); assert.equal(db.tasks[0].status, "done"); assert.ok(db.crm_notifications[0].dismissed_at);
await taskEmail.sendTaskEmailDraft(draft.id); assert.equal(sends, 1, "Repeated approval never sends twice");

// Real React composer. Opening loads only. Only an explicit click generates.
Date.now = clock;
const dom = new JSDOM('<div id="root"></div>', { url: "https://crm.test/crm/notifications" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const browserCalls = [];
let recognition;
window.SpeechRecognition = class {
  constructor() { recognition = this; }
  start() {}
  stop() { this.onend?.(); }
};
const uiDraft = { ...draft, status: "draft" };
const Composer = compile("components/crm/TaskEmailComposer.tsx", {
  "@/lib/dictation": compile("lib/dictation.ts"),
  "@/lib/crm": { crmConfirmationError: input => new Error(input.reason), crmFetch: async (url, init = {}) => {
    browserCalls.push({ url, method: init.method || "GET", body: init.body && JSON.parse(init.body) });
    if (!init.method) return { recipients: [{ email: "ben@example.test", name: "Ben", source: "inbound" }], selectedRecipientEmail: "ben@example.test", draft: null, suggestedIntent: "Arrange a catch-up", capabilities };
    if (init.method === "PATCH") return { ok: true, draft: { ...uiDraft, draft_body: JSON.parse(init.body).body } };
    return { ok: true, draft: uiDraft };
  } },
}).default;
const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(Composer, { taskId: "", notificationId, taskText: "Reply to Ben", onClose() {}, onSent() {} })); });
assert.equal(browserCalls.length, 1); assert.equal(browserCalls[0].method, "GET");
const button = text => [...document.querySelectorAll("button")].find(node => node.textContent === text);
await act(async () => document.querySelector('[aria-label="Speak email intent"]').click());
const spoken = [{ transcript: "Please mention the product demo" }]; spoken.isFinal = true;
await act(async () => recognition.onresult({ results: [spoken] }));
assert.ok([...document.querySelectorAll("textarea")].some(node => node.value.includes("Please mention the product demo")));
assert.equal(browserCalls.length, 1, "Dictation does not generate a draft automatically");
await act(async () => document.querySelector('[aria-label="Stop email intent dictation"]').click());
await act(async () => button("Draft reply").click());
assert.equal(browserCalls.at(-1).method, "POST"); assert.equal(browserCalls.at(-1).body.regenerate, false);
assert.match(browserCalls.at(-1).body.intent, /Please mention the product demo/);
assert.ok(button("Approve and send"));
const textarea = [...document.querySelectorAll("textarea")].find(node => node.value === uiDraft.draft_body);
assert.ok(textarea);
await act(async () => Simulate.change(textarea, { target: { value: "My own edited reply to Ben" } }));
await act(async () => button("Save draft").click());
assert.equal(browserCalls.at(-1).method, "PATCH");
assert.equal(browserCalls.at(-1).body.body, "My own edited reply to Ben");
assert.ok(browserCalls.every(call => !call.url.endsWith("/send")), "Neither opening, drafting nor editing sends");
await act(async () => root.unmount());
dom.window.close();

// No old scheduled path can create a reply automatically, including old queued tasks.
const monitor = read("app/api/cron/important-email-monitor/route.ts");
assert.doesNotMatch(monitor, /generateEmailAssistantDraft/);
assert.match(monitor, /draftMode: shouldDraft \? "on_request" : "none"/);
const cron = compile("app/api/cron/email-next-moves/route.ts");
const oldSecret = process.env.CRON_SECRET; process.env.CRON_SECRET = "test-secret";
assert.equal((await cron.GET(new NextRequest("https://crm.test/cron"))).status, 401);
assert.deepEqual(await (await cron.GET(new NextRequest("https://crm.test/cron", { headers: { authorization: "Bearer test-secret" } }))).json(), { ok: true, skipped: "on_request", created: 0 });
if (oldSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldSecret;
const handoff = read("lib/email-assistant.ts");
assert.ok(handoff.indexOf("await assertReplyMeetingOptionsCurrent") < handoff.indexOf("const providerDraft = await createConnectedMailDraft"));
const migration = read("supabase/migrations/20261026110602_notification_reply_meeting_options.sql");
assert.match(migration, /add column if not exists meeting_options jsonb/);
assert.doesNotMatch(migration, /\b(drop|delete|grant|policy)\b/i);
console.log("Notification replies passed. On-request generation, exact threads, two-user isolation, typed edits, dual-provider calendar availability, DST, buffers, complete pagination, explicit send, send-time recheck and idempotent completion.");
