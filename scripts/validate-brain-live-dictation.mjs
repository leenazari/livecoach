import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, "utf8");
const { foldDictationEvent, stabiliseLiveDictationPreview } = await import(
  "../lib/dictation.ts"
);

const result = (transcript, isFinal = false) => ({
  0: { transcript },
  isFinal,
});

const interim = foldDictationEvent("", [result("show me the latest words")]);
assert.equal(interim.text, "show me the latest words");
assert.equal(interim.committed, "");

assert.equal(
  stabiliseLiveDictationPreview(
    "show me the latest four lines",
    "",
    false
  ),
  "show me the latest four lines"
);
assert.equal(
  stabiliseLiveDictationPreview(
    "show me the latest four lines",
    "show me the latest",
    false
  ),
  "show me the latest four lines"
);
assert.equal(
  stabiliseLiveDictationPreview(
    "show me the latest for lines",
    "show me the latest four lines",
    true
  ),
  "show me the latest four lines"
);

const assistant = read("components/crm/ClientAssistant.tsx");
assert.match(assistant, /stabiliseLiveDictationPreview/);
assert.match(assistant, /el\.scrollTop = el\.scrollHeight/);
assert.match(assistant, /rows=\{listening \? 4 : 1\}/);
assert.match(assistant, /min-h-\[108px\]/);

console.log("Brain live dictation preview validation passed");
