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

const { buildInterviewerPrompt, campaignOpening, interviewerGreeting, knowledgeManifest } = loadTs(new URL("../lib/interviewer/prompt.ts", import.meta.url).pathname);
const { choosePages, pickInternalLinks, sitemapLocs } = loadTs(new URL("../lib/interviewer/website-pages.ts", import.meta.url).pathname);
const { INTERVIEWER_VOICES, FALLBACK_INTERVIEWER_VOICE } = loadTs(new URL("../lib/interviewer/voices.ts", import.meta.url).pathname);
const { knowledgeTitleFromNote, validateCampaignFields } = loadTs(new URL("../lib/interviewer/form-fields.ts", import.meta.url).pathname);
const { presentTranscript } = loadTs(new URL("../lib/interviewer/transcript-display.ts", import.meta.url).pathname);
const { isHoldRequest, nextSilenceCue } = loadTs(new URL("../lib/interviewer/silence.ts", import.meta.url).pathname);
const { parseBrief, fallbackBrief } = loadTs(new URL("../lib/interviewer/brief.ts", import.meta.url).pathname);
const { cleanSlideText, isInternalCostLine } = loadTs(new URL("../lib/interviewer/slide-notes.ts", import.meta.url).pathname);

const notes = [{ title: "What Adam is", body: "Adam is a website sales agent. It books demos." }];
const prompt = buildInterviewerPrompt({
  campaignName: "Adam test",
  prospectName: "Lee",
  personaOverride: "Book a 20-minute demo. Never quote prices.",
  promptOverride: null,
  maxMinutes: null,
  documents: notes,
  slides: [{ number: 1, title: "Proof", oneLine: "After they describe the problem", talkingPoints: "Show the result they asked about", verbatim: null }],
});
if (!prompt.startsWith("PERSONA")) throw new Error("persona is not first");
if (!prompt.includes("GLOBAL SALES PLAYBOOK")) throw new Error("playbook missing");
if (!prompt.includes("mm-hm")) throw new Error("backchannels missing");
if (prompt.indexOf("WEBSITE KNOWLEDGE") > prompt.indexOf("GLOBAL SALES PLAYBOOK")) throw new Error("notes must come before the playbook");
if (!prompt.includes("What brought you") && !prompt.toLowerCase().includes("inbound")) throw new Error("inbound opener missing");
if (!prompt.includes("Adam is a website sales agent")) throw new Error("knowledge note missing from prompt");
if (!prompt.includes("Never quote prices")) throw new Error("persona missing from prompt");
if (prompt.toLowerCase().includes("per minute") || prompt.includes("GBP")) throw new Error("billing leaked into the prompt");
if (campaignOpening({ campaignName: "Adam test", documents: notes }) !== "Adam is a website sales agent.") {
  throw new Error("opening did not use the note");
}

const ids = new Set(INTERVIEWER_VOICES.map((voice) => voice.id));
if (!ids.has("aura-2-draco-en") || !ids.has("aura-2-thalia-en") || !ids.has("aura-athena-en")) {
  throw new Error("catalogue missing a documented voice");
}
const draco = INTERVIEWER_VOICES.find((voice) => voice.id === "aura-2-draco-en");
if (!draco || draco.accent !== "British" || draco.gender !== "masculine") throw new Error("Draco tags drifted from the docs");
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

if (!isHoldRequest("Can you hold on a second?")) throw new Error("hold phrase missed");
if (isHoldRequest("I like the product")) throw new Error("ordinary line treated as a hold");
const quiet = { now: 30_000, lastActivityAt: 0, lastSpeaker: "agent", phase: "clear", holdSince: null, muted: false, mutedSince: null, muteChecked: false, speaking: false };
if (nextSilenceCue(quiet) !== "check") throw new Error("silence check missing");
if (nextSilenceCue({ ...quiet, now: 20_000, phase: "checked" }) !== "warn") throw new Error("silence warning missing");
if (nextSilenceCue({ ...quiet, now: 15_000, phase: "warned" }) !== "end") throw new Error("silence end missing");
if (nextSilenceCue({ ...quiet, speaking: true }) !== "none") throw new Error("cut off while speaking");
if (nextSilenceCue({ ...quiet, muted: true, mutedSince: 0, now: 4 * 60_000 }) !== "mute-check") throw new Error("mute check missing");
const facts = { name: "Lee", email: "lee@example.com", disposition: "Hot", reason: null, timing: null, connectedAt: null, endedAt: null, scheduledAt: null, talkShareLead: 40, slides: [], transcript: "Lead: hello" };
const parsed = parseBrief({ lead: { phone: "not a phone", interest: "Solar" }, intent: { label: "HOT", reasons: ["Asked about price"] } }, facts);
if (parsed.lead.phone !== null || parsed.lead.email !== "lee@example.com" || parsed.intent.reasons.length !== 3) throw new Error("brief parser drifted");
if (fallbackBrief(facts).source !== "record") throw new Error("fallback brief missing");
if (isInternalCostLine("More leads. Lower cost. Always on.")) throw new Error("a benefit slogan was treated as an internal cost");
if (!isInternalCostLine("Deepgram cost is seven cents a minute")) throw new Error("supplier cost was kept");
if (cleanSlideText("More leads. Lower cost. Always on.\nOur cost per minute is hidden.").includes("Our cost")) {
  throw new Error("internal cost line was left in the slide notes");
}
if (!prompt.includes("Talking points:")) throw new Error("talking points missing from the prompt");
const kioskPrompt = buildInterviewerPrompt({
  campaignName: "Swoopos",
  prospectName: "Lee",
  personaOverride: null,
  promptOverride: null,
  maxMinutes: null,
  documents: [{ title: "Products and services", body: "Self-service kiosks are one hundred and ninety nine pounds a month (£199)." }],
  deckKnowledge: "9. Self-service kiosks in your brand\n- Self-service ordering\n- Price on the page: £199 a month",
  slides: [{ number: 9, title: "Self-service kiosks in your brand", oneLine: "When they ask about kiosks", talkingPoints: "Branded self-service kiosks.", verbatim: null }],
});
if (!kioskPrompt.includes("Self-service kiosks in your brand")) throw new Error("deck kiosk knowledge missing from the prompt");
if (!kioskPrompt.includes("£199")) throw new Error("kiosk price missing from the prompt");
if (!/Never say that it is not in your notes/i.test(kioskPrompt)) throw new Error("missing-notes deflection was not banned");
if (!/Great choice/i.test(kioskPrompt)) throw new Error("gushing line was not banned");
const asked = knowledgeManifest(kioskPrompt);
if (!asked.mentionsKiosk || !asked.sections.includes("Deck")) throw new Error("pre-call knowledge check missed the deck");
const home = new URL("https://swoopos.com/");
const crawled = choosePages([
  "https://swoopos.com/",
  ...sitemapLocs("<urlset><url><loc>https://swoopos.com/get-kiosk</loc></url><url><loc>https://other.example/no</loc></url></urlset>", home),
  ...pickInternalLinks('<a href="/pos">POS</a><a href="https://swoopos.com/get-kiosk">Kiosk</a>', home),
], home, 25);
if (!crawled.some((url) => url.includes("/get-kiosk"))) throw new Error("kiosk page was not crawled");
if (crawled.some((url) => url.includes("other.example"))) throw new Error("left the site");
const greeting = interviewerGreeting({ campaignName: "Solar", prospectName: "Lee Nazari", personaOverride: null, promptOverride: null, maxMinutes: null, documents: notes, opener: "Welcome to the company. Let me tell you everything about our history and then a tip about muting." });
if (greeting !== "Hi Lee, thanks for joining. What brings you here today?") throw new Error(`greeting was too long: ${greeting}`);
if (/tip|mute|solar/i.test(greeting)) throw new Error("greeting included a pitch or a tip");

console.log("interviewer owner and prompt checks passed");
