import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OUTREACH_CAMPAIGN_CONTENT_FIELDS,
  outreachCampaignPermissions,
} from "../lib/outreach-campaign-permissions.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

assert.deepEqual(
  outreachCampaignPermissions({
    role: "sales",
    memberStatus: "active",
    campaignVisibility: "team",
  }),
  { canEditCampaignContent: true, canManageCampaign: false },
  "An active salesperson can edit a shared campaign's copy and sequence"
);
assert(
  OUTREACH_CAMPAIGN_CONTENT_FIELDS.includes("cta_config"),
  "A salesperson can edit the CTA copy on a shared campaign"
);
assert.deepEqual(
  outreachCampaignPermissions({
    role: "sales",
    memberStatus: "active",
    campaignVisibility: "private",
  }),
  { canEditCampaignContent: false, canManageCampaign: false },
  "A salesperson must never edit a private campaign"
);
assert.deepEqual(
  outreachCampaignPermissions({
    role: "manager",
    memberStatus: "active",
    campaignVisibility: "private",
  }),
  { canEditCampaignContent: true, canManageCampaign: true },
  "A manager retains campaign controls"
);
assert.deepEqual(
  outreachCampaignPermissions({
    role: "sales",
    memberStatus: "suspended",
    campaignVisibility: "team",
  }),
  { canEditCampaignContent: false, canManageCampaign: false },
  "A suspended member cannot edit a campaign"
);

const updateRoute = read("app/api/crm/outreach/campaigns/[id]/route.ts");
const listRoute = read("app/api/crm/outreach/campaigns/route.ts");
const page = read("app/crm/outreach/page.tsx");

assert.match(updateRoute, /outreachCampaignPermissions/);
assert.match(updateRoute, /eq\("visibility", "team"\)/);
assert.match(updateRoute, /permissions\.canManageCampaign/);
assert.match(updateRoute, /shared_outreach_campaign_content_updated/);
assert.match(updateRoute, /actor_user_id: account\.userId/);
assert.match(updateRoute, /sanitizeOutreachCampaignCtaConfig/);
assert.match(updateRoute, /patch\.cta_config = result\.config/);
assert.doesNotMatch(
  updateRoute,
  /signature:\s*String\(body\.voice\.signature/,
  "A shared campaign must not override an individual salesperson's sign off"
);
assert.match(listRoute, /canEditCampaignContent/);
assert.match(listRoute, /cta_config: ctaResult\.config/);
assert.match(page, /canEditCampaignContent/);
assert.match(page, /Shared · copy editable/);
assert.match(page, /Only Lee or a manager can change its status or daily maximum/);
assert.match(page, /Save shared campaign copy/);
assert.match(page, /CampaignCtaEditor/);

console.log("Sales campaign editing validation passed");
