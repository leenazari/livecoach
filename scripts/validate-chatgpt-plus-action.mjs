import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const definitions = read("lib/chatgpt-action.ts");
const tools = read("lib/staff-mcp-tools.ts");
const auth = read("lib/staff-mcp-auth.ts");
const actionRoute = read("app/api/chatgpt/actions/[action]/route.ts");
const schemaRoute = read("app/api/chatgpt/actions/openapi/route.ts");
const setupRoute = read("app/api/crm/chatgpt-action/setup/route.ts");
const statusRoute = read("app/api/crm/mcp/status/route.ts");
const settings = read("components/McpChatGptConnection.tsx");
const consent = read("app/oauth/consent/page.tsx");
const migration = read(
  "supabase/migrations/20261028123000_chatgpt_plus_action_clients.sql"
);

const coreActions = [
  "find_my_lead",
  "list_my_leads",
  "add_lead",
  "add_lead_context",
  "create_my_follow_up",
  "list_my_tasks",
];
for (const action of coreActions) {
  assert.match(definitions, new RegExp(`tool: "${action}"`));
  assert.match(tools, new RegExp(`"${action}"`));
}
assert.doesNotMatch(
  definitions,
  /send|campaign|assign_to|permission|credential|execute_brain/i
);

assert.match(actionRoute, /verifyStaffMcpAccessToken\([\s\S]*?accessToken,[\s\S]*?"chatgpt_action"/);
assert.match(actionRoute, /"chatgpt_action"/);
assert.match(actionRoute, /principalFromAuthInfo\(authInfo\)/);
assert.match(actionRoute, /executeStaffCoreAction/);
assert.match(actionRoute, /MAX_BODY_BYTES = 32 \* 1024/);
assert.match(actionRoute, /Cache-Control.*private, no-store/);
assert.doesNotMatch(actionRoute, /supabaseService|SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(actionRoute, /send|start_campaign|change_permissions/i);

assert.match(schemaRoute, /openapi: "3\.1\.0"/);
assert.match(schemaRoute, /type: "oauth2"/);
assert.match(schemaRoute, /authorizationCode/);
assert.match(schemaRoute, /authorizationUrl/);
assert.match(schemaRoute, /tokenUrl/);
assert.match(schemaRoute, /"x-openai-isConsequential": input\.consequential/);
assert.match(schemaRoute, /consequential: false/g);
assert.match(schemaRoute, /consequential: true/g);
assert.match(schemaRoute, /another salesperson's private records/);
assert.match(schemaRoute, /This never sends outreach/);

assert.match(setupRoute, /requireWorkspaceOwner\(\)/);
assert.match(setupRoute, /normaliseChatGptId/);
assert.match(setupRoute, /client_uri: "https:\/\/chatgpt\.com"/);
assert.match(setupRoute, /token_endpoint_auth_method: "client_secret_post"/);
assert.match(setupRoute, /privacyPolicyUrl/);
assert.match(setupRoute, /chatGptActionCallbackUrls\(gptId\)/);
assert.match(setupRoute, /oauth\.createClient/);
assert.match(setupRoute, /oauth\.deleteClient/);
assert.match(setupRoute, /clientSecret: oauthClient\.client_secret/);
assert.doesNotMatch(
  setupRoute.match(/\.insert\(\{[\s\S]*?\}\);/)?.[0] || "",
  /client_secret|clientSecret/
);

assert.match(migration, /create table if not exists public\.chatgpt_action_clients/);
assert.match(migration, /alter table public\.chatgpt_action_clients enable row level security/);
assert.match(migration, /wm\.status = 'active'/);
assert.match(migration, /wm\.role = 'owner'/);
assert.match(migration, /created_by = \(select auth\.uid\(\)\)/);
assert.doesNotMatch(migration, /client_secret/i);
assert.doesNotMatch(migration, /grant[^;]*delete[^;]*authenticated/i);

assert.match(auth, /chatgpt_action_clients/);
assert.match(auth, /clientType === "chatgpt_action"/);
assert.match(auth, /Narrow ChatGPT clients cannot use the full LiveCoach MCP connector/);
assert.match(auth, /\.eq\("workspace_id", workspaceId\)/);
assert.match(auth, /\.eq\("oauth_client_id", clientId\)/);
assert.match(auth, /\.eq\("active", true\)/);
assert.match(auth, /memberships\.length !== 1/);
assert.match(tools, /leadAccessFilter\(principal\.userId\)/);
assert.match(tools, /\.eq\("owner_id", principal\.userId\)/);
assert.match(tools, /workspace_id: principal\.workspaceId/);
assert.match(tools, /assigned_to_user_id: principal\.userId/);
assert.match(tools, /visibility: "private"/);
assert.match(tools, /tool\.inputSchema\["~standard"\]\.validate/);

assert.match(statusRoute, /actionSchemaUrl/);
assert.match(statusRoute, /actionConfigured/);
assert.match(statusRoute, /role: scope\.role/);
assert.match(settings, /Route 1 · ChatGPT Plus/);
assert.match(settings, /Personal LiveCoach CRM plugin/);
assert.match(settings, /Route 2 · Workspace owner only/);
assert.match(settings, /It cannot[\s\S]*send\s+outreach, run campaigns/);
assert.doesNotMatch(settings, /Generate OAuth details/);
assert.doesNotMatch(settings, /Shared LiveCoach Custom GPT/);
assert.match(consent, /connectorKind === "chatgpt_action"/);
assert.match(consent, /from\("chatgpt_action_clients"\)/);
assert.match(consent, /setConnectorKind\("chatgpt_action"\)/);
assert.doesNotMatch(consent, /client\.name\?\.startsWith\("LiveCoach CRM GPT Action/);
assert.match(consent, /Send outreach, start campaigns or book meetings/);

console.log("ChatGPT Plus action validation passed");
