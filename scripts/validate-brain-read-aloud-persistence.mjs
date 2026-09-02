import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const assistant = readFileSync(
  `${root}components/crm/ClientAssistant.tsx`,
  "utf8"
);

assert.match(
  assistant,
  /BRAIN_READ_ALOUD_STORAGE_KEY = "lc_brain_read_aloud"/
);
assert.match(
  assistant,
  /window\.localStorage\.getItem\([\s\S]*?BRAIN_READ_ALOUD_STORAGE_KEY/
);
assert.match(
  assistant,
  /window\.localStorage\.setItem\([\s\S]*?BRAIN_READ_ALOUD_STORAGE_KEY/
);
assert.match(assistant, /const readAloudRef = useRef\(true\)/);
assert.match(assistant, /if \(readAloudRef\.current\) \{/);
assert.doesNotMatch(assistant, /if \(readAloud \|\| convoRef\.current\)/);
assert.match(
  assistant,
  /applyReadAloudPreference\(!readAloudRef\.current\)/
);
assert.match(
  assistant,
  /window\.addEventListener\("storage", syncFromAnotherTab\)/
);
assert.match(
  assistant,
  /Muting read-aloud must remain authoritative even in hands-free mode/
);

console.log("Brain read-aloud persistence validation passed");
