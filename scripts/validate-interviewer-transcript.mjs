import { readFileSync } from "node:fs";
import { createListenFold } from "../lib/interviewer/listen-transcript.ts";
import { isDuplicateUtterance, looksLikeSpeakerEcho } from "../lib/interviewer/listen-transcript.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/interviewer-double-transcript.json", import.meta.url), "utf8"));

for (const example of fixture) {
  const fold = createListenFold();
  const byId = new Map();
  let interim = "";
  for (const frame of example.frames) {
    const decision = fold.push(frame);
    interim = decision.interim;
    if (decision.lock) byId.set(decision.lock.id, decision.lock.text);
    if (decision.revise) byId.set(decision.revise.id, decision.revise.text);
  }
  const tail = fold.flush();
  if (tail) byId.set(tail.id, tail.text);
  const committed = [...byId.values()];
  if (JSON.stringify(committed) !== JSON.stringify(example.committed)) {
    throw new Error(`${example.name}: got ${JSON.stringify(committed)}`);
  }
  if (interim !== example.lastInterim) {
    throw new Error(`${example.name}: interim stayed ${JSON.stringify(interim)}`);
  }
}

if (!isDuplicateUtterance(
  [{ speaker: "lead", text: "Hello there.", ts: "2026-11-14T12:00:00.000Z" }],
  { speaker: "lead", text: "hello there", ts: "2026-11-14T12:00:01.000Z" }
)) {
  throw new Error("repeated lead line was not treated as a duplicate");
}

if (isDuplicateUtterance(
  [{ speaker: "lead", text: "Hello there.", ts: "2026-11-14T12:00:00.000Z" }],
  { speaker: "agent", text: "hello there", ts: "2026-11-14T12:00:01.000Z" }
)) {
  throw new Error("agent and lead lines were collapsed together");
}

if (!looksLikeSpeakerEcho("have you got a couple of minutes", [
  "Hi, it's the team at Northwind, have you got a couple of minutes?",
])) {
  throw new Error("speaker echo was kept as the lead");
}

console.log("interviewer transcript checks passed");
