import assert from "node:assert/strict";
import { buildTeamInvitationActionUrl } from "../lib/team-invitation-link.ts";

const actionUrl = buildTeamInvitationActionUrl({
  appOrigin: "https://www.livecoachcrm.com",
  authTokenHash: "auth-token-hash",
  authVerificationType: "magiclink",
  workspaceInvitationToken: "workspace/token + value",
});
const parsed = new URL(actionUrl);

assert.equal(parsed.origin, "https://www.livecoachcrm.com");
assert.equal(parsed.pathname, "/auth/callback");
assert.equal(parsed.searchParams.get("token_hash"), "auth-token-hash");
assert.equal(parsed.searchParams.get("type"), "magiclink");
assert.equal(
  parsed.searchParams.get("next"),
  "/join-team?invite=workspace%2Ftoken%20%2B%20value"
);
assert.equal(parsed.hash, "", "the invitation must not rely on a browser-only URL fragment");

console.log("team invitation link validation passed");
