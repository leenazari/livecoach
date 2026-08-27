import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isOfficialJobResearchUrl,
  officialJobSearchDomains,
  sanitiseJobResearchSignals,
} from "../lib/job-research-sources.ts";

const prospect = { website: "https://example-recruitment.co.uk", company_domain: "example-recruitment.co.uk" };
assert.equal(isOfficialJobResearchUrl("https://example-recruitment.co.uk/careers/consultant", prospect), true);
assert.equal(isOfficialJobResearchUrl("https://jobs.lever.co/example/123", prospect), true);
assert.equal(isOfficialJobResearchUrl("https://boards.greenhouse.io/example/jobs/123", prospect), true);
assert.equal(isOfficialJobResearchUrl("https://apply.workable.com/example/j/123", prospect), true);
assert.equal(isOfficialJobResearchUrl("https://jobs.ashbyhq.com/example/123", prospect), true);
assert.equal(isOfficialJobResearchUrl("https://www.linkedin.com/jobs/view/123", prospect), false);
assert.equal(isOfficialJobResearchUrl("https://uk.indeed.com/viewjob?jk=123", prospect), false);
assert.ok(officialJobSearchDomains(prospect).includes("example-recruitment.co.uk"));
assert.equal(
  sanitiseJobResearchSignals([
    { role: "Recruitment consultant", location: "Birmingham", recency: "Current", sourceUrl: "https://example-recruitment.co.uk/careers/consultant" },
    { role: "Fake role", location: "", recency: "", sourceUrl: "https://linkedin.com/jobs/123" },
  ], prospect).length,
  1
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const route = read("app/api/crm/outreach/[id]/prepare/route.ts");
const wrapper = read("lib/openai.ts");
assert.match(route, /filters: \{ allowed_domains: jobSearchDomains \}/);
assert.match(route, /Never search, open, scrape or cite LinkedIn/);
assert.doesNotMatch(route, /LinkedIn hint/);
assert.match(route, /sanitiseJobResearchSignals/);
assert.match(wrapper, /allowed_domains: webSearchTool\.filters\.allowed_domains/);

console.log("Official job research checks passed");
