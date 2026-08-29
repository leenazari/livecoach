import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  candidatePreparationJobScore,
  isOfficialJobResearchUrl,
  isCandidatePreparationCampaign,
  officialJobBoardUrl,
  officialJobSearchDomains,
  rankCandidatePreparationJobSignals,
  sanitiseJobResearchSignals,
  verifiedJobResearchEvidence,
} from "../lib/job-research-sources.ts";

const prospect = { website: "https://example-recruitment.co.uk", company_domain: "example-recruitment.co.uk" };
assert.equal(isOfficialJobResearchUrl("https://example-recruitment.co.uk/careers/consultant", prospect), true);
assert.equal(isOfficialJobResearchUrl("https://jobs.lever.co/example/123", prospect), true);
assert.equal(isOfficialJobResearchUrl("https://boards.greenhouse.io/example/jobs/123", prospect), true);
assert.equal(isOfficialJobResearchUrl("https://apply.workable.com/example/j/123", prospect), true);
assert.equal(isOfficialJobResearchUrl("https://jobs.ashbyhq.com/example/123", prospect), true);
assert.equal(isOfficialJobResearchUrl("https://www.linkedin.com/jobs/view/123", prospect), false);
assert.equal(isOfficialJobResearchUrl("https://uk.indeed.com/viewjob?jk=123", prospect), false);
assert.equal(isOfficialJobResearchUrl("example-recruitment.co.uk/jobs", prospect), false);
assert.equal(isOfficialJobResearchUrl("javascript:alert(1)", prospect), false);
assert.ok(officialJobSearchDomains(prospect).includes("example-recruitment.co.uk"));
assert.equal(
  officialJobBoardUrl([
    { title: "Head of Product", url: "https://example-recruitment.co.uk/job/head-of-product" },
    { title: "Current jobs", url: "https://example-recruitment.co.uk/jobs/" },
  ], prospect),
  "https://example-recruitment.co.uk/jobs/"
);
assert.equal(
  officialJobBoardUrl([
    { title: "Head of Product", url: "https://example-recruitment.co.uk/job/head-of-product" },
    { title: "Jobs", url: "https://www.linkedin.com/jobs/view/123" },
  ], prospect),
  "",
  "An exact vacancy or blocked network must not be relabelled as a job board"
);
assert.equal(
  sanitiseJobResearchSignals([
    { role: "Recruitment consultant", location: "Birmingham", compensation: "£45,000 per annum", recency: "Current", sourceUrl: "https://example-recruitment.co.uk/careers/consultant" },
    { role: "Fake role", location: "", recency: "", sourceUrl: "https://linkedin.com/jobs/123" },
  ], prospect).length,
  1
);

assert.equal(isCandidatePreparationCampaign({
  name: "Recruitment leaders",
  audience: "Recruiters",
  goal: "Help recruiters prepare candidates",
  offerAngle: "Five minute mock interview before the client interview",
}), true);
assert.equal(isCandidatePreparationCampaign({
  name: "Employer screening",
  audience: "Hiring teams",
  goal: "Screen candidates",
  offerAngle: "Automated first stage assessment",
}), false);

const prioritised = rankCandidatePreparationJobSignals(sanitiseJobResearchSignals([
  { role: "Head of Sales", location: "London", compensation: "£150,000 per annum", recency: "Current", sourceUrl: "https://example-recruitment.co.uk/careers/head-of-sales" },
  { role: "Head of Engineering", location: "London", compensation: "£120,000 per annum", recency: "Current", sourceUrl: "https://example-recruitment.co.uk/careers/head-of-engineering" },
  { role: "Office Administrator", location: "London", compensation: "£200,000 per annum", recency: "Current", sourceUrl: "https://example-recruitment.co.uk/careers/office-administrator" },
], prospect));
assert.equal(prioritised[0].role, "Head of Engineering");
assert.equal(prioritised[0].compensation, "£120,000 per annum");
assert.ok(candidatePreparationJobScore(prioritised[0]) > candidatePreparationJobScore(prioritised[1]));
const evidence = verifiedJobResearchEvidence(
  { jobSignals: prioritised },
  [{ title: "Jobs", url: "https://example-recruitment.co.uk/jobs/" }],
  prospect
);
assert.equal(evidence.jobBoardUrl, "https://example-recruitment.co.uk/jobs/");
assert.equal(evidence.jobSignals.length, 3);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const route = read("app/api/crm/outreach/[id]/prepare/route.ts");
const queueRoute = read("app/api/crm/outreach/queue/route.ts");
const outreachPage = read("app/crm/outreach/page.tsx");
const todayLane = read("components/crm/OutreachTodayLane.tsx");
const outreachCrm = read("lib/outreach-crm.ts");
const companyRoute = read("app/api/crm/companies/[id]/route.ts");
const companyPage = read("app/crm/[id]/page.tsx");
const wrapper = read("lib/openai.ts");
assert.match(route, /filters: \{ allowed_domains: jobSearchDomains \}/);
assert.match(route, /Never search, open, scrape or cite LinkedIn/);
assert.doesNotMatch(route, /LinkedIn hint/);
assert.match(route, /sanitiseJobResearchSignals/);
assert.match(route, /CANDIDATE PREPARATION VACANCY PRIORITY/);
assert.match(route, /Higher compensation is supporting evidence/);
assert.match(route, /rankCandidatePreparationJobSignals/);
assert.match(route, /compensation: \{ type: "string" \}/);
assert.match(route, /const jobBoardUrl = officialJobBoardUrl\(sources, prospect\)/);
assert.match(route, /jobBoardUrl,/);
assert.match(queueRoute, /verifiedJobResearchEvidence/);
assert.match(queueRoute, /jobSignals: jobEvidence\.jobSignals/);
assert.match(outreachPage, /Open company job board/);
assert.match(outreachPage, /Verified vacancies/);
assert.match(todayLane, /Open company job board/);
assert.match(todayLane, /Verified vacancies/);
assert.match(outreachCrm, /jobBoardUrl: research\.jobBoardUrl \|\| null/);
assert.match(companyRoute, /loadVerifiedCompanyJobEvidence/);
assert.match(companyRoute, /salesResearch,/);
assert.match(companyPage, /Verified hiring evidence/);
assert.match(wrapper, /allowed_domains: webSearchTool\.filters\.allowed_domains/);

console.log("Official job research checks passed");
