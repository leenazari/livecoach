import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveBrainKnownNames,
  resolveBrainSelfName,
} from "../lib/brain-self-name.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assistant = readFileSync(
  path.join(root, "app/api/crm/assistant/route.ts"),
  "utf8"
);
const identities = readFileSync(
  path.join(root, "lib/brain-self-identity.ts"),
  "utf8"
);

const lee = {
  canonicalName: "Lee Nazari",
  aliases: ["Lee Nazari", "Lena Zari"],
};

assert.equal(
  resolveBrainSelfName("search for Lina Azri", lee).resolvedMessage,
  "search for Lee Nazari"
);
assert.equal(
  resolveBrainSelfName("I've got an appointment with Lina Zari on Monday", lee)
    .resolvedMessage,
  "I've got an appointment with Lee Nazari on Monday"
);
assert.equal(
  resolveBrainSelfName("what did Leena Zari do yesterday", lee).resolvedMessage,
  "what did Lee Nazari do yesterday"
);
assert.equal(
  resolveBrainSelfName("Can you communicate with Lee Naziri", lee)
    .resolvedMessage,
  "Can you communicate with Lee Nazari"
);
assert.equal(
  resolveBrainSelfName("find Lee Nazari's last call", lee).resolvedMessage,
  "find Lee Nazari's last call"
);
assert.equal(
  resolveBrainSelfName("search for Lina Azri", lee, ["Lina Azri"])
    .resolvedMessage,
  "search for Lina Azri",
  "An exact visible CRM contact must win over self-name correction"
);
assert.equal(
  resolveBrainSelfName("search for Lina Azri", {
    canonicalName: "Kamm Singh",
    aliases: ["Kamm Singh"],
  }).resolvedMessage,
  "search for Lina Azri",
  "A salesperson's Brain must never map Lee's voice variant to itself"
);
assert.equal(
  resolveBrainKnownNames("I've got an appointment with Lina Zari on Monday", [
    {
      canonicalName: "Kamm",
      aliases: ["Kamm"],
      relationship: "signed_in_user",
    },
    {
      ...lee,
      relationship: "workspace_owner",
    },
  ]).resolvedMessage,
  "I've got an appointment with Lee Nazari on Monday",
  "A team member must resolve a speech variant to the workspace owner, not itself"
);
assert.equal(
  resolveBrainSelfName("discuss line zero", lee).resolvedMessage,
  "discuss line zero",
  "Phonetic correction must not run outside lookup-style requests"
);

assert.match(assistant, /content: rawMessage/);
assert.match(assistant, /gatherGlobalContext\(contextMessage\)/);
assert.match(assistant, /gatherCallTranscriptContext\(contextMessage/);
assert.match(assistant, /exactVisibleContactNamesIn\(rawMessage\)/);
assert.match(assistant, /Workspace owner:/);
assert.match(assistant, /Identity correction changes no access rights/);
assert.match(identities, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(identities, /\.select\("display_name,transcriber_aliases"\)/);
const ownerLookup = identities.slice(
  identities.indexOf("const { data: ownerMembership")
);
assert.doesNotMatch(
  ownerLookup,
  /select\("display_name,email,transcriber_aliases"\)/
);

console.log("Brain known-identity name resolution checks passed");
