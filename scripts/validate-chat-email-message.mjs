import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/crm-chat.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const scope = { userId: "sender", workspaceId: "workspace" };
const input = { scope, conversationId: "conversation", messageId: "message" };
const chatUrl = "https://www.livecoachcrm.com/crm/chat?conversation=conversation";

async function deliver({ body = "Hello", group = false, missing = false, error = null, duplicate = false, enabled = true } = {}) {
  const sent = [];
  const writes = [];
  const lookups = [];
  const db = {
    from(table) {
      const filters = {};
      let values;
      let operation = "select";
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        neq(key, value) { filters[`${key}!=`] = value; return query; },
        in(key, value) { filters[key] = value; return query; },
        insert(value) { operation = "insert"; values = value; return query; },
        update(value) { operation = "update"; values = value; return query; },
        single() { return query; },
        maybeSingle() { return query; },
        then(resolve, reject) {
          lookups.push({ table, filters });
          if (operation !== "select") writes.push({ table, operation, values });
          let result;
          switch (table) {
            case "crm_chat_conversation_members":
              result = { data: [{ user_id: "recipient" }, { user_id: "muted" }] }; break;
            case "profiles":
              result = { data: [
                { user_id: "sender", display_name: "Sharon <Huynh>", email: "sender@example.test" },
                { user_id: "recipient", display_name: "Lee", email: "lee@example.test" },
                { user_id: "muted", display_name: "Muted", email: "muted@example.test" },
                { user_id: "outsider", display_name: "Outsider", email: "outsider@example.test" },
              ] }; break;
            case "crm_chat_conversations":
              result = { data: { kind: group ? "group" : "direct", name: "Sales <team>" } }; break;
            case "crm_notification_preferences":
              result = { data: [
                { user_id: "recipient", chat_email_enabled: enabled },
                { user_id: "muted", chat_email_enabled: false },
              ] }; break;
            case "crm_chat_messages":
              result = { data: missing ? null : { body }, error }; break;
            case "crm_chat_email_deliveries":
              result = duplicate && operation === "insert"
                ? { data: null, error: { code: "23505" } }
                : { data: { id: "delivery" } }; break;
            default: throw new Error(`Unexpected table ${table}`);
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console,
    require(name) {
      if (name === "server-only") return {};
      if (name === "@/lib/mail") return { sendConnectedMail: async (mail, sender) => {
        sent.push({ ...mail, sender }); return { ok: true, id: "provider-message" };
      } };
      if (name === "@/lib/public-app-url") return { publicAppOrigin: () => "https://www.livecoachcrm.com" };
      if (name === "@/lib/crm-chat-shared") return {};
      if (name === "@/lib/supabase") return { supabaseService: db };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  await module.exports.sendChatEmailNotifications(input);
  return { sent, writes, lookups };
}

const body = 'Please assign Jason to Sharon.\n<script>alert("x")</script> & thanks\n' + "Full message ".repeat(410);
const result = await deliver({ body });
assert.equal(result.sent.length, 1, "Only opted-in conversation recipients receive the message");
const mail = result.sent[0];
assert.equal(mail.to, "lee@example.test");
assert.equal(mail.sender, scope.userId);
assert.ok(mail.text.includes(body), "The full saved message must appear without truncation");
assert.ok(mail.text.includes(chatUrl));
assert.match(mail.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; thanks/);
assert.doesNotMatch(mail.html, /<script>/);
assert.match(mail.html, /Sharon &lt;Huynh&gt;/);
assert.match(mail.html, /Sharon\.<br \/>/, "Message line breaks are preserved");
assert.match(mail.html, /Open chat and reply/);
assert.ok(mail.html.includes(chatUrl));
const lookup = result.lookups.find((row) => row.table === "crm_chat_messages");
assert.deepEqual(lookup.filters, {
  workspace_id: scope.workspaceId, conversation_id: input.conversationId,
  id: input.messageId, sender_user_id: scope.userId,
});
assert.ok(result.writes.some((row) => row.operation === "update" && row.values.status === "sent"));

const group = await deliver({ body: "Hello group", group: true });
assert.match(group.sent[0].text, /Sales <team>/);
assert.match(group.sent[0].html, /Sales &lt;team&gt;/);
const attachment = await deliver({ body: "" });
assert.match(attachment.sent[0].text, /Shared a file or CRM record/);
assert.match(attachment.sent[0].html, /Shared a file or CRM record/);
assert.equal((await deliver({ enabled: false })).sent.length, 0);
assert.equal((await deliver({ duplicate: true })).sent.length, 0);
await assert.rejects(deliver({ missing: true }), /Message not found/);
await assert.rejects(deliver({ error: new Error("Message lookup failed") }), /Message lookup failed/);
console.log("Chat email message checks passed");
