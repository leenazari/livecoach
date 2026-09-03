import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const signals = read("lib/opportunity-signals.ts");
const route = read("app/api/crm/opportunities/[id]/route.ts");
const canonical = read("lib/canonical-opportunity.ts");
const page = read("app/crm/revenue/page.tsx");
const workspace = read("components/crm/PipelineWorkspace.tsx");
const commercialMemory = read("lib/commercial-memory.ts");
const crmContext = read("lib/crm-context.ts");
const migration = read(
  "supabase/migrations/20260828183949_opportunity_deal_intent_intelligence.sql"
);

// One existing material-signal assessment derives both the evidence-led
// outlook and forward-looking deal intent. No page-load generation is added.
assert.match(signals, /required: \[[^\]]*"dealIntent"/);
assert.match(signals, /dealIntent: \{ type: "string", maxLength: 600 \}/);
assert.match(signals, /The first sentence must state the desired commercial outcome/);
assert.match(signals, /The second sentence must state what the next conversation needs to confirm/);
assert.match(signals, /deal_intent: dealIntent/);
assert.match(signals, /deal_intent_as_of: assessedAt/);
assert.match(signals, /deal_intent_source: "system"/);
assert.match(signals, /const outlookProtected = opportunity\.win_outlook_override === true/);
assert.match(signals, /const intentProtected = opportunity\.deal_intent_override === true/);
assert.match(signals, /if \(outlookProtected && intentProtected\)/);
assert.match(signals, /if \(!intentProtected\) updateQuery = updateQuery\.eq\("deal_intent_override", false\)/);

// A human edit creates a visible lock. Clearing the lock is explicit and the
// canonical selection recognises the protected record.
assert.match(route, /A human deal intent override is active/);
assert.match(route, /patch\.deal_intent_override = true/);
assert.match(route, /patch\.deal_intent_source = sourceType/);
assert.match(route, /body\.clearDealIntentOverride === true/);
assert.match(canonical, /left\.deal_intent_override/);
assert.match(canonical, /right\.deal_intent_override/);
assert.match(page, /clearDealIntentOverride: row\.clearDealIntentOverride === true/);
assert.match(workspace, /Your wording is locked against automatic changes/);
assert.match(workspace, /Updated from the latest stored commercial evidence/);
assert.match(workspace, /Allow automatic updates/);
assert.match(commercialMemory, /intentOverride: opportunity\.deal_intent_override === true/);
assert.match(crmContext, /deal_intent_source, deal_intent_override/);
assert.match(crmContext, /deal_intent_override \? " \(human override\)"/);

// The database stores provenance and immutable history with the same existing
// owner and workspace scope. It does not create a second source of truth.
assert.match(migration, /deal_intent_as_of timestamptz/);
assert.match(migration, /deal_intent_source text not null default 'system'/);
assert.match(migration, /deal_intent_override boolean not null default false/);
assert.match(migration, /new\.deal_intent_source is distinct from old\.deal_intent_source/);
assert.match(migration, /workspace_id, owner_id, visibility/);
assert.match(migration, /new\.workspace_id, new\.owner_id, coalesce\(new\.visibility, 'private'\)/);

console.log("Opportunity deal intent intelligence checks passed");
