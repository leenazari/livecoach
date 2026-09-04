import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseTranscriptDownloadId,
  renderTranscriptDownload,
  transcriptDownloadFilename,
} from "../lib/call-transcript-download.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

assert.deepEqual(parseTranscriptDownloadId("call-123"), {
  kind: "summary",
  id: "call-123",
});
assert.deepEqual(parseTranscriptDownloadId("session:recall_123"), {
  kind: "session",
  id: "recall_123",
});
assert.equal(parseTranscriptDownloadId("session:"), null);
assert.equal(parseTranscriptDownloadId("../private"), null);

const rawTranscript = "Lee: First line\nBuyer: Second line with £ and punctuation.";
const rendered = renderTranscriptDownload({
  title: "Discovery call",
  company: "Example Recruitment",
  recordedAt: "2026-08-25T09:30:00.000Z",
  participants: ["Lee", "Buyer"],
  transcript: rawTranscript,
});
assert.ok(rendered.endsWith(rawTranscript), "The stored transcript must remain unchanged");
assert.match(rendered, /Example Recruitment/);
assert.match(rendered, /Lee, Buyer/);
assert.equal(
  transcriptDownloadFilename("Example / Recruitment", "2026-08-25T09:30:00Z"),
  "example-recruitment-2026-08-25-transcript.txt"
);

const downloadRoute = read("app/api/crm/calls/[id]/transcript/route.ts");
const callsRoute = read("app/api/crm/calls/route.ts");
const companyCallsRoute = read("app/api/crm/companies/[id]/calls/route.ts");
const callsPage = read("app/crm/calls/page.tsx");
const callPage = read("app/crm/calls/[id]/page.tsx");
const companyPage = read("app/crm/[id]/page.tsx");
const prepRedirect = read("app/crm/prep/page.tsx");
const portfolioRoute = read("app/api/crm/clients/portfolio/route.ts");
const portfolio = read("components/crm/ClientPortfolio.tsx");

assert.match(downloadRoute, /requireRequestScope\(\)/);
assert.match(downloadRoute, /\.eq\("workspace_id", account\.workspaceId\)/);
assert.match(downloadRoute, /\.eq\("owner_id", account\.userId\)/);
assert.match(downloadRoute, /\.eq\("session_id", sessionId\)/);
assert.match(downloadRoute, /companyId !== session\.company_id/);
assert.match(downloadRoute, /loadSharedCallAccess/);
assert.match(downloadRoute, /sharedAccess\.capture/);
assert.match(downloadRoute, /\.eq\("owner_id", \(sharedAccess\.capture as any\)\.owner_id\)/);
assert.match(downloadRoute, /Content-Disposition/);
assert.match(downloadRoute, /private, no-store/);
assert.doesNotMatch(downloadRoute, /openai|anthropic/i);

assert.match(callsRoute, /hasTranscript/);
assert.match(companyCallsRoute, /hasTranscript/);
assert.match(companyCallsRoute, /\.eq\("owner_id", scope\.userId\)/);
for (const page of [callsPage, callPage, companyPage]) {
  assert.match(page, /\/transcript/);
  assert.match(page, /download/i);
}
assert.match(prepRedirect, /redirect\(`\/call/);

assert.match(portfolioRoute, /select\("id,company_id,candidate,created_at"\)/);
assert.match(portfolioRoute, /lastCallId/);
assert.match(portfolioRoute, /lastCallAt/);
assert.doesNotMatch(portfolioRoute, /\.select\([^\n]*transcript/);
assert.match(portfolio, /last call ↗/);
assert.match(portfolio, /row\.lastCallId/);
assert.match(portfolio, /\/crm\/calls\/\$\{row\.lastCallId\}/);

console.log("Transcript download and latest-call navigation checks passed");
