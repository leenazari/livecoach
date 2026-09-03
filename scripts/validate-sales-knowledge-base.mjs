import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260903221221_sales_knowledge_team_governance.sql"
);
const hardening = read(
  "supabase/migrations/20260903222707_sales_knowledge_advisor_hardening.sql"
);
const api = read("app/api/crm/pitch-playbook/route.ts");
const lessonApi = read("app/api/crm/lessons/[id]/route.ts");
const privateLibraryApi = read("app/api/crm/lessons/route.ts");
const page = read("app/crm/pitch-playbook/page.tsx");
const callPage = read("app/crm/calls/[id]/page.tsx");
const nav = read("components/crm/NavMenu.tsx");
const workspace = read("lib/workspace.ts");
const search = read("app/api/crm/search/route.ts");

for (const column of [
  "kind text",
  "status text",
  "source_label text",
  "source_fingerprint text",
  "updated_at timestamptz",
]) {
  assert.match(migration, new RegExp(column.replace(" ", "\\s+")));
}
assert.match(migration, /lessons_workspace_source_fingerprint_uidx/);
assert.match(hardening, /lessons_owner_id_fkey_idx/);
assert.match(migration, /Members read approved team knowledge/);
assert.match(migration, /visibility = 'team' and status = 'approved'/);
assert.match(migration, /owner_id = \(select auth\.uid\(\)\)/);
assert.match(migration, /wm\.status = 'active'/);
assert.match(migration, /wm\.role in \('owner', 'manager'\)/);
assert.match(migration, /Authors update owned knowledge/);
assert.match(migration, /Authors delete owned knowledge/);
assert.match(
  migration,
  /lessons\.visibility = 'private'[\s\S]*wm\.role in \('owner', 'manager'\)/
);

assert.match(api, /const MANAGER_ROLES = new Set\(\["owner", "manager"\]\)/);
assert.match(api, /FIELD_NOTE_MAX_CHARS = 16_000/);
assert.match(api, /body\?\.kind === "field_note"/);
assert.match(api, /Use a complete http or https source link/);
assert.match(api, /createHash\("sha256"\)/);
assert.match(api, /Naming a product alone is weak evidence/);
assert.match(api, /Verify the workflow, direct user, result and limitation/);
assert.match(api, /Paraphrase\. Do not reproduce a passage or sentence/);
assert.match(api, /visibility: "private"/);
assert.match(api, /kind: "field_note"/);
assert.match(api, /status: "draft"/);
assert.match(api, /content: JSON\.stringify\(content\)/);
assert.doesNotMatch(api, /content:\s*source[,\n]/);
assert.equal(
  (api.match(/\.eq\("workspace_id", scope\.workspaceId\)/g) || []).length >= 8,
  true,
  "Sales knowledge reads must repeatedly bind the exact workspace"
);
assert.equal(
  (api.match(/\.eq\("owner_id", scope\.userId\)/g) || []).length >= 5,
  true,
  "Private call evidence must repeatedly bind the exact owner"
);
for (const forbidden of [
  "/sendpilot",
  "outreach/enrol",
  "outreach/engage",
  "mail.send",
]) {
  assert.doesNotMatch(api, new RegExp(forbidden));
}

assert.match(lessonApi, /publish_team/);
assert.match(lessonApi, /make_private/);
assert.match(lessonApi, /archive/);
assert.match(lessonApi, /Only the lesson's author can change or archive it/);
assert.match(lessonApi, /Only a workspace owner or manager can publish/);
assert.match(lessonApi, /LiveCoach did not confirm the requested knowledge access state/);

assert.match(privateLibraryApi, /requireRequestScope\(\)/);
assert.match(privateLibraryApi, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(privateLibraryApi, /\.eq\("owner_id", scope\.userId\)/);
assert.match(privateLibraryApi, /\.neq\("topic", "pitching"\)/);

for (const copy of [
  "sales knowledge base",
  "Add field lesson",
  "Build private lesson",
  "Publish to team",
  "LiveCoach safeguard",
  "Calibration guide",
  "Knowledge check",
]) {
  assert.match(page, new RegExp(copy, "i"));
}
assert.match(page, /approved field lessons and proven patterns from real calls/i);
assert.match(callPage, /Sales knowledge base/);
assert.match(nav, /label: "Sales knowledge"/);

assert.match(workspace, /RELEVANT APPROVED SALES KNOWLEDGE/);
assert.match(workspace, /Evidence type: externally sourced field lesson/);
assert.match(workspace, /Operating principle/);
assert.match(workspace, /Calibration guide/);
assert.match(workspace, /Diagnostic questions/);
assert.equal(
  (workspace.match(/\.eq\("workspace_id", scope\.workspaceId\)/g) || []).length >= 2,
  true
);
assert.equal(
  (workspace.match(/\.eq\("status", "approved"\)/g) || []).length >= 2,
  true
);
assert.match(workspace, /owner_id\.eq\.\$\{scope\.userId\},visibility\.eq\.team/);

assert.match(search, /\.from\("lessons"\)[\s\S]*\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(search, /and\(visibility\.eq\.team,status\.eq\.approved\)/);
assert.match(search, /content\.principle/);

console.log("Sales knowledge base checks passed");
