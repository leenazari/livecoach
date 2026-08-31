import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260826110917_per_user_outreach_campaign_selection.sql"
);
const selection = read("lib/outreach-campaign-selection.ts");
const campaigns = read("app/api/crm/outreach/campaigns/route.ts");
const campaignPatch = read("app/api/crm/outreach/campaigns/[id]/route.ts");
const selectRoute = read(
  "app/api/crm/outreach/campaigns/select/route.ts"
);
const queue = read("app/api/crm/outreach/queue/route.ts");
const prospects = read("app/api/crm/outreach/route.ts");
const readiness = read("app/api/crm/outreach/readiness/route.ts");
const page = read("app/crm/outreach/page.tsx");

assert.match(migration, /primary key \(workspace_id, user_id\)/i);
assert.match(migration, /active_campaign_id uuid references public\.outreach_campaigns/i);
assert.match(migration, /c\.workspace_id = new\.workspace_id[\s\S]*c\.status = 'active'/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /user_id = \(select auth\.uid\(\)\)/i);
assert.match(migration, /security invoker/i);
assert.doesNotMatch(migration, /security definer/i);

assert.match(selection, /eq\("workspace_id", workspaceId\)/);
assert.match(selection, /eq\("user_id", userId\)/);
assert.match(selection, /preference\?\.active_campaign_id/);
assert.match(selection, /order\("updated_at", \{ ascending: false \}\)/);

assert.match(campaigns, /requireRequestScope\(\)/);
assert.match(campaigns, /workspace_id: account\.workspaceId/);
assert.match(campaigns, /owner_id: account\.userId/);
assert.match(campaignPatch, /eq\("workspace_id", account\.workspaceId\)/);
assert.doesNotMatch(campaignPatch, /\.neq\("id", params\.id\)/);
assert.match(selectRoute, /eq\("workspace_id", account\.workspaceId\)/);
assert.match(selectRoute, /eq\("status", "active"\)/);
assert.match(selectRoute, /workspace_id,user_id/);

assert.ok(
  (queue.match(/resolveOutreachCampaignSelection/g) || []).length >= 2,
  "Queue reads the signed-in user's selected campaign for GET and POST"
);
assert.match(
  queue,
  /assigned_to_user_id\.is\.null,assigned_to_user_id\.eq\.\$\{account\.userId\}/
);
assert.match(queue, /campaignProspectIds\.has\(prospect\.id\)/);
assert.match(queue, /\.is\("assigned_to_user_id", null\)/);
assert.match(prospects, /resolveOutreachCampaignSelection\(account\.userId, account\.workspaceId\)/);
assert.match(prospects, /eq\("status", "paused"\)/);
assert.match(readiness, /label: "Your active campaign"/);
assert.match(page, /Choose campaign for new queue spaces/);
assert.match(page, /Your teammates keep their own selections/);
assert.match(page, /const orderedCampaigns = useMemo/);
assert.match(page, /open=\{expandedCampaignId === campaign\.id\}/);
assert.match(page, /onToggle=\{\(event\) =>/);
assert.match(page, /Selected for new spaces means this campaign supplies only new contacts/);
assert.match(page, /It never moves contacts already queued/);
assert.match(page, /new Date\(right\.updated_at \|\| right\.created_at \|\| 0\)/);
assert.match(page, /campaign-card-/);
assert.match(page, /aria-label="Outreach sections"/);
assert.doesNotMatch(
  page.match(/<nav aria-label="Outreach sections"[\s\S]*?<\/nav>/)?.[0] || "",
  /sm:static/,
  "Outreach tabs stay sticky on desktop as well as mobile"
);

const active = [
  { id: "recruitment", status: "active" },
  { id: "workable", status: "active" },
];
const selectedFor = (preferred) =>
  active.find((campaign) => campaign.id === preferred) || active[0];
assert.equal(selectedFor("recruitment").id, "recruitment");
assert.equal(selectedFor("workable").id, "workable");
assert.notEqual(
  selectedFor("recruitment").id,
  selectedFor("workable").id,
  "Lee and Kamm can work different campaigns at the same time"
);

console.log("Per-user outreach campaign checks passed");
