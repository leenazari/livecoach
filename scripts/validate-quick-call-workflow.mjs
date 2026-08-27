import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanQuickCallSuggestion,
  dueDateFromDays,
  fallbackQuickCallSuggestion,
} from "../lib/quick-call.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

assert.deepEqual(
  fallbackQuickCallSuggestion({
    outcome: "no_answer",
    currentStage: "qualified",
  }),
  {
    pipelineStage: "qualified",
    nextAction: "Call again at a different time",
    nextActionOwner: "us",
    dueInDays: 2,
    rationale: "The call was not answered",
  }
);

assert.equal(
  cleanQuickCallSuggestion(
    {
      pipelineStage: "won",
      nextAction: "  Send   recap  ",
      nextActionOwner: "buyer",
      dueInDays: 999,
      rationale: "Explicit next step",
    },
    fallbackQuickCallSuggestion({
      outcome: "connected",
      currentStage: "discovery",
    })
  ).pipelineStage,
  "discovery",
  "A call-note model cannot auto-close an opportunity"
);
assert.equal(
  cleanQuickCallSuggestion(
    {
      pipelineStage: "proposal",
      nextAction: "Send recap",
      nextActionOwner: "buyer",
      dueInDays: 999,
      rationale: "Explicit next step",
    },
    fallbackQuickCallSuggestion({
      outcome: "connected",
      currentStage: "discovery",
    })
  ).dueInDays,
  90
);
assert.equal(
  dueDateFromDays(2, new Date("2026-08-24T10:00:00Z")),
  "2026-08-26"
);

const route = read("app/api/crm/opportunities/[id]/quick-call/route.ts");
const opportunityRoute = read("app/api/crm/opportunities/[id]/route.ts");
const lane = read("components/crm/SalesPipelineLane.tsx");
const inbox = read("app/crm/inbox/page.tsx");
const sharing = read("app/settings/team/sharing/page.tsx");
const migration = read(
  "supabase/migrations/20260824173500_quick_call_overrides.sql"
);

assert.match(route, /requireRequestScope\(\)/);
assert.match(route, /loadVisibleOpportunityById<any>/);
assert.match(route, /assigned_to_user_id !== account\.userId/);
assert.match(route, /event_type: "call_logged"/);
assert.match(route, /event_type: "call_interpreted"/);
assert.ok(
  route.indexOf('event_type: "call_logged"') <
    route.indexOf("openai.messages.create"),
  "The source note must be stored before optional interpretation"
);
assert.match(route, /pipeline_stage_override === true/);
assert.match(route, /next_action_override === true/);
assert.doesNotMatch(route, /interview_sessions|meet_utterances|transcript/);

assert.match(opportunityRoute, /pipeline_stage_override = true/);
assert.match(opportunityRoute, /next_action_override = true/);
assert.match(migration, /call_logged/);
assert.match(migration, /call_interpreted/);
assert.match(migration, /opportunity_events_quick_call_request_uidx/);
assert.match(migration, /source_type = 'human' and changes \? 'pipeline_stage'/);

assert.match(lane, /Log activity/);
assert.match(lane, /Save activity and update deal/);
assert.match(lane, /Face to face/);
assert.match(route, /QUICK_ACTIVITY_METHODS/);
assert.match(route, /active_contact_method: contactMethod/);
assert.match(lane, /Human override protects/);
assert.match(inbox, /quickCallRequestId/);
assert.match(inbox, /\/quick-call/);

assert.match(sharing, /Recruitment master list/);
assert.match(sharing, /Filter outreach by source list/);
assert.match(sharing, /counts\.ready.*counts\.total/);

console.log("Quick call and master-list allocation checks passed");
