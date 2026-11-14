import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const cache = new Map();
function loadTs(file) {
  const abs = path.resolve(file);
  if (cache.has(abs)) return cache.get(abs);
  const compiled = ts.transpileModule(readFileSync(abs, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const dirname = path.dirname(abs);
  new Function("require", "module", "exports", compiled)((specifier) => {
    if (specifier.startsWith("@/")) {
      const resolved = path.resolve("/workspace", specifier.slice(2));
      return loadTs(resolved.endsWith(".ts") ? resolved : `${resolved}.ts`);
    }
    if (!specifier.startsWith(".")) return nodeRequire(specifier);
    const resolved = path.resolve(dirname, specifier);
    return loadTs(resolved.endsWith(".ts") ? resolved : `${resolved}.ts`);
  }, module, module.exports);
  cache.set(abs, module.exports);
  return module.exports;
}

const { buildInterviewerPrompt, campaignOpening } = loadTs(new URL("../lib/interviewer/prompt.ts", import.meta.url).pathname);
const { INTERVIEWER_VOICES, FALLBACK_INTERVIEWER_VOICE } = loadTs(new URL("../lib/interviewer/voices.ts", import.meta.url).pathname);
const { knowledgeTitleFromNote, validateCampaignFields } = loadTs(new URL("../lib/interviewer/form-fields.ts", import.meta.url).pathname);
const { presentTranscript } = loadTs(new URL("../lib/interviewer/transcript-display.ts", import.meta.url).pathname);

const notes = [{ title: "What Adam is", body: "Adam is a website sales agent. It books demos." }];
const prompt = buildInterviewerPrompt({
  campaignName: "Adam test",
  prospectName: "Lee",
  personaOverride: "Book a 20-minute demo. Never quote prices.",
  promptOverride: null,
  maxMinutes: null,
  documents: notes,
});
if (!prompt.startsWith("PERSONA")) throw new Error("persona is not first");
if (!prompt.includes("GLOBAL SALES PLAYBOOK")) throw new Error("playbook missing");
if (!prompt.includes("mm-hm")) throw new Error("backchannels missing");
if (prompt.indexOf("CAMPAIGN NOTES") > prompt.indexOf("GLOBAL SALES PLAYBOOK")) throw new Error("notes must come before the playbook");
if (!prompt.includes("Adam is a website sales agent")) throw new Error("knowledge note missing from prompt");
if (!prompt.includes("Never quote prices")) throw new Error("persona missing from prompt");
if (prompt.toLowerCase().includes("per minute") || prompt.includes("GBP")) throw new Error("billing leaked into the prompt");
if (campaignOpening({ campaignName: "Adam test", documents: notes }) !== "Adam is a website sales agent.") {
  throw new Error("opening did not use the note");
}

const ids = INTERVIEWER_VOICES.map((voice) => `${voice.id} ${voice.accent}`);
if (ids.join("|") !== [
  "aura-2-draco-en British",
  "aura-2-pandora-en British",
  "aura-helios-en British",
  "aura-athena-en British",
].join("|")) throw new Error(ids.join(", "));
if (FALLBACK_INTERVIEWER_VOICE !== "aura-2-pandora-en") throw new Error("fallback changed");
const emptyVoice = validateCampaignFields({ name: "Adam", voiceId: "", maxMinutes: "" });
if (emptyVoice.fields.voiceId !== "Choose a voice.") throw new Error("empty voice was accepted");

if (knowledgeTitleFromNote("A ".repeat(10) + "long note about the product and nothing else at all here please") .length > 60) {
  throw new Error("title was not shortened");
}

const shown = presentTranscript([
  { id: "1", speaker: "lead", text: "I've seen some of your solar panels, and I'm just" },
  { id: "2", speaker: "agent", text: "Tell me more about those panels." },
  { id: "3", speaker: "lead", text: "in finding out how they work." },
]);
if (shown[0].speaker !== "agent") throw new Error("newest speaker was not first");
if (!shown.some((line) => line.speaker === "lead" && line.text.includes("I'm just in finding out"))) {
  throw new Error(`lead fragments were not merged: ${JSON.stringify(shown)}`);
}

console.log("interviewer owner and prompt checks passed");
