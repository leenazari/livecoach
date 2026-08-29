import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compactOutreachResearchFacts,
  rankNamedOutreachProspects,
} from "../lib/brain-outreach-reference.ts";

const prospects = [
  {
    id: "generic-john",
    first_name: "John",
    company_name: "Waylands Automotive",
    research: null,
  },
  {
    id: "john-watkins",
    first_name: "John",
    last_name: "Watkins",
    company_name: "Altima",
    last_researched_at: "2026-08-11T15:01:10Z",
    research: {
      activeJobs: [],
      summary: "No current Altima vacancies were verifiable.",
      personalisationFact:
        "Altima published research about CFO hiring intentions.",
    },
  },
  {
    id: "john-veal",
    first_name: "John",
    last_name: "Veal",
    company_name: "Nobul Resourcing Solutions",
    last_researched_at: "2026-08-29T11:56:36Z",
    research: {
      personalisationFact:
        "Nobul currently lists a Head of Sales vacancy in London.",
      activeJobs: [
        "Head of Sales · London · Live listing crawled 2 weeks ago",
        "Head of Product · England · Live listing crawled today",
      ],
      jobSignals: [{ role: "Head of Sales", recency: "Live listing" }],
      freshness: "Nobul jobs board checked today.",
    },
  },
];

const matched = rankNamedOutreachProspects(
  "How did you know that John in outreach has a live job post?",
  prospects
);
assert.equal(matched[0]?.id, "john-veal");
assert.equal(matched[1]?.id, "john-watkins");
assert.equal(matched[2]?.id, "generic-john");

assert.equal(
  rankNamedOutreachProspects("What do we know about John Watkins?", prospects)[0]
    ?.id,
  "john-watkins"
);
assert.equal(
  rankNamedOutreachProspects("What is happening at Nobul?", prospects)[0]?.id,
  "john-veal"
);

const facts = compactOutreachResearchFacts(prospects[2].research);
assert.match(facts.join(" "), /Head of Sales/);
assert.match(facts.join(" "), /Nobul jobs board checked today/);
assert.doesNotMatch(facts.join(" "), /https?:\/\//);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = readFileSync(path.join(root, "lib/crm-context.ts"), "utf8");
assert.match(context, /rankNamedOutreachProspects\(message, prospects, 25\)/);
assert.match(context, /rankNamedOutreachProspects\(message, enrichedCandidates, 3\)/);
assert.match(context, /select\("id,research,last_researched_at"\)/);
assert.match(context, /identityCandidates\.map\(\(prospect\) => prospect\.id\)/);
assert.doesNotMatch(
  context,
  /assigned_to_user_id,research,last_researched_at/
);
assert.match(context, /Saved research:/);
assert.match(context, /Ask only when the evidence remains genuinely tied/);
assert.ok(
  context.indexOf("NAMED OUTREACH REFERENCE CANDIDATES") <
    context.indexOf("if (options.detailed)"),
  "named evidence must appear before generic detailed roll-ups"
);

console.log("Brain outreach follow-up reference checks passed");
