import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const auth = read("lib/staff-mcp-auth.ts");
const tools = read("lib/staff-mcp-tools.ts");
const http = read("lib/staff-mcp-http.ts");
const route = read("app/mcp/chatgpt/route.ts");
const metadata = read("lib/staff-mcp-metadata.ts");
const metadataRoute = read(
  "app/.well-known/oauth-protected-resource/mcp/chatgpt/route.ts"
);
const status = read("app/api/crm/mcp/status/route.ts");
const settings = read("components/McpChatGptConnection.tsx");
const consent = read("app/oauth/consent/page.tsx");
const docs = read("docs/staff-chatgpt-mcp.md");
const migration = read(
  "supabase/migrations/20261028132013_chatgpt_plugin_client_boundary.sql"
);
const indexMigration = read(
  "supabase/migrations/20261028132634_chatgpt_plugin_client_indexes.sql"
);

const registeredCoreTools = [
  ...tools.matchAll(/server\.registerTool\(\s*"([^"]+)"/g),
].map((match) => match[1]);
assert.deepEqual(registeredCoreTools, [
  "find_my_lead",
  "list_my_leads",
  "add_lead",
  "add_lead_context",
  "create_my_follow_up",
  "list_my_tasks",
]);

assert.match(auth, /\| "chatgpt_plugin"/);
assert.match(auth, /chatGptPluginMcpResourceUrl/);
assert.match(auth, /LIVECOACH_CHATGPT_PLUGIN_MCP_RESOURCE_URL/);
assert.match(auth, /configured \|\| "\/mcp\/chatgpt"/);
assert.match(auth, /clientType === "chatgpt_plugin"/);
assert.match(auth, /from\("chatgpt_plugin_clients"\)/);
assert.match(auth, /actionClient \|\| !pluginClient/);
assert.match(auth, /actionClient \|\| pluginClient/);
assert.match(auth, /role !== "owner"/);
assert.match(auth, /full LiveCoach Brain connector is restricted to a workspace owner/);
assert.doesNotMatch(auth, /SUPABASE_SERVICE_ROLE_KEY|supabaseAdmin|supabaseService/);

assert.match(route, /createStaffMcpHttpRoute/);
assert.match(route, /clientType: "chatgpt_plugin"/);
assert.match(route, /serverOptions: \{ coreOnly: true \}/);
assert.match(route, /chatGptPluginMcpResourceUrl/);
assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|supabaseAdmin|supabaseService/);

assert.match(http, /verifyStaffMcpAccessToken\(token, options\.clientType\)/);
assert.match(http, /hostHeaderValidationResponse/);
assert.match(http, /originValidationResponse/);
assert.match(http, /Cache-Control", "private, no-store"/);
assert.doesNotMatch(http, /SUPABASE_SERVICE_ROLE_KEY|supabaseAdmin|supabaseService/);

assert.match(tools, /coreOnly\?: boolean/);
assert.match(tools, /options\.coreOnly \? "LiveCoach CRM for ChatGPT"/);
assert.match(tools, /Before add_lead, add_lead_context or create_my_follow_up/);
assert.match(tools, /wait for explicit confirmation/);
assert.match(tools, /Never send outreach, start campaigns, book meetings/);
assert.match(tools, /change code, credentials, roles or permissions/);
assert.match(tools, /Never claim success without ok true and a receiptId/);
assert.match(tools, /Do not retry a write when the outcome is unknown/);
assert.match(tools, /if \(!options\.coreOnly\)/);
assert.doesNotMatch(tools, /SUPABASE_SERVICE_ROLE_KEY|supabaseAdmin|supabaseService/);

assert.match(metadata, /chatGptPluginMcpProtectedResourceMetadata/);
assert.match(metadata, /name: "LiveCoach CRM for ChatGPT"/);
assert.match(metadataRoute, /chatGptPluginMcpProtectedResourceMetadata/);
assert.match(status, /pluginEndpoint: chatGptPluginMcpResourceUrl\(\)\.href/);

assert.match(settings, /Personal LiveCoach CRM plugin/);
assert.match(settings, /status\.pluginEndpoint/);
assert.match(settings, /Add custom MCP server/);
assert.match(settings, /Use OAuth discovery/);
assert.match(settings, /review the six tools/);
assert.match(settings, /Never connect Kamm/);
assert.doesNotMatch(settings, /Generate OAuth details/);

assert.match(consent, /classify_chatgpt_authorization/);
assert.match(consent, /p_register_plugin: false/);
assert.match(consent, /p_register_plugin: true/);
assert.match(consent, /connectorKind === "chatgpt_plugin"/);

assert.match(migration, /create table if not exists public\.chatgpt_plugin_clients/);
assert.match(migration, /alter table public\.chatgpt_plugin_clients enable row level security/);
assert.match(migration, /grant select on table public\.chatgpt_plugin_clients to authenticated/);
assert.doesNotMatch(migration, /grant (?:insert|update|delete)[^;]*authenticated/i);
assert.match(migration, /create or replace function public\.classify_chatgpt_authorization/);
assert.match(migration, /security definer/);
assert.match(migration, /set search_path = ''/);
assert.match(migration, /authz\.user_id = v_user_id/);
assert.match(migration, /authz\.status::text = 'pending'/);
assert.match(migration, /https:\/\/www\.livecoachcrm\.com\/mcp\/chatgpt/);
assert.match(migration, /client\.registration_type::text = 'dynamic'/);
assert.match(migration, /client\.client_type::text = 'public'/);
assert.match(migration, /client\.token_endpoint_auth_method = 'none'/);
assert.match(migration, /v_role <> 'owner'/);
assert.match(migration, /revoke execute[\s\S]*from public, anon/);
assert.match(migration, /grant execute[\s\S]*to authenticated/);
assert.match(indexMigration, /chatgpt_plugin_clients_created_by_idx/);
assert.match(indexMigration, /on public\.chatgpt_plugin_clients \(created_by\)/);

assert.match(docs, /https:\/\/www\.livecoachcrm\.com\/mcp\/chatgpt/);
assert.match(docs, /Repeat this once for each salesperson/);
assert.match(docs, /OAuth token is bound to the narrow plugin resource/);

console.log("ChatGPT personal plugin MCP validation passed");
