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
const { choosePages, pickInternalLinks, sitemapLocs, routeScriptText, readablePageText, dropInventedPrices, scriptRoutes } = loadTs(new URL("../lib/interviewer/website-pages.ts", import.meta.url).pathname);
const { websiteImportIds, knowledgeFromDocuments, WEBSITE_IMPORT_SOURCE } = loadTs(new URL("../lib/interviewer/knowledge.ts", import.meta.url).pathname);
const { INTERVIEWER_VOICES, FALLBACK_INTERVIEWER_VOICE } = loadTs(new URL("../lib/interviewer/voices.ts", import.meta.url).pathname);
const { knowledgeTitleFromNote, validateCampaignFields } = loadTs(new URL("../lib/interviewer/form-fields.ts", import.meta.url).pathname);
const { presentTranscript } = loadTs(new URL("../lib/interviewer/transcript-display.ts", import.meta.url).pathname);
const { toSpokenPlain, stripAgentContext, toolReplyForAgent } = loadTs(new URL("../lib/interviewer/spoken-text.ts", import.meta.url).pathname);
const { effectiveCallMinutes, twoMinuteLine, formatCountdown, timeLimitChapters, remainingCallSeconds } = loadTs(new URL("../lib/interviewer/call-limit.ts", import.meta.url).pathname);
const { keywordsFor, matchSpokenSlide } = loadTs(new URL("../lib/interviewer/slide-match.ts", import.meta.url).pathname);
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
if (effectiveCallMinutes(null) !== 30 || effectiveCallMinutes(180) !== 30 || effectiveCallMinutes(12) !== 12) throw new Error("call limit was not capped at 30");
if (!twoMinuteLine(false).startsWith("I only have around two minutes")) throw new Error("warning line is not first person");
if (twoMinuteLine(true).includes("demo")) throw new Error("booked warning still offered a demo");
if (formatCountdown(125) !== "2:05") throw new Error("countdown format drifted");
const ends = Date.now() + 90_000;
if (remainingCallSeconds(ends, Date.now()) < 80) throw new Error("remaining seconds drifted");
const marks = timeLimitChapters(30 * 60, 30 * 60);
if (!marks.some((item) => item.kind === "warning" && item.atSeconds === 28 * 60)) throw new Error("two minute chapter missing");
if (!marks.some((item) => item.kind === "limit")) throw new Error("time limit chapter missing");
if (timeLimitChapters(60, 1800).length) throw new Error("short call was given a time-limit chapter");
const kds = { number: 11, keywords: keywordsFor({ title: "Kitchen display screen: every order in view" }) };
const kiosk = { number: 9, keywords: keywordsFor({ title: "Self-service kiosks in your brand" }) };
if (matchSpokenSlide("the kitchen display shows every order", [kds, kiosk], 1) !== 11) throw new Error("KDS mention did not select the kitchen slide");
if (matchSpokenSlide("tell me about the kiosk", [kds, kiosk], 11) !== 9) throw new Error("kiosk mention did not switch slides");
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
if (!kioskPrompt.includes("one hundred and ninety nine pounds a month")) throw new Error("kiosk price was not spoken in words");
if (kioskPrompt.includes("**") || kioskPrompt.includes("£")) throw new Error("markup or a pound sign reached the prompt");
const spoken = toSpokenPlain("**Kitchen display**\n# KDS\n• loyalty\n- tipping\n£60/month\nhttps://swoopos.com/get-kiosk\n😀");
if (/[*#_`•£]|https|😀/.test(spoken)) throw new Error(`markup survived: ${spoken}`);
const leaked = stripAgentContext("See **kiosks** at https://abc.supabase.co/storage/v1/object/sign/slide.png?token=secret then call show_slide");
if (/supabase|https|\*\*/.test(leaked)) throw new Error(`technical text reached the agent: ${leaked}`);
if (!leaked.includes("show_slide") || !leaked.includes("kiosks")) throw new Error(`plain fact was removed: ${leaked}`);
if (toolReplyForAgent("show_slide", { url: "https://abc.supabase.co/x" }) !== "shown") throw new Error("show_slide reply was not minimal");
if (!spoken.includes("sixty pounds a month") || !spoken.includes("Kitchen display") || !spoken.includes("loyalty.")) throw new Error(`spoken text drifted: ${spoken}`);
const marked = presentTranscript([{ id: "m", speaker: "agent", text: "The **kiosk** is £60/month." }]);
if (marked.some((line) => line.text.includes("**") || line.text.includes("£"))) throw new Error("transcript still shows markup");
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
const kept = websiteImportIds([
  { id: "hand-1", source: null, title: "Products: tills, Waiter Mate handhelds and SoftPOS" },
  { id: "hand-2", source: null, title: "Prices" },
  { id: "hand-3", source: null, title: "Common questions and objections" },
  { id: "import-1", source: WEBSITE_IMPORT_SOURCE, title: "Products and services" },
]);
if (kept.length !== 1 || kept[0] !== "import-1") throw new Error("a handwritten note was marked for deletion");
const keptNotes = knowledgeFromDocuments([
  { title: "Products and services", body: "invented", source: WEBSITE_IMPORT_SOURCE },
  { title: "Products: tills, Waiter Mate handhelds and SoftPOS", body: "tills and Waiter Mate", source: null },
]);
if (!keptNotes.products.includes("Waiter Mate")) throw new Error("handwritten product note was hidden");
const bundle = 'function U2(){return o.jsx(R0,{subheading:"Get a POS for Just £199/month",headingOne:"SELF SERVICE KIOSKS"})}function P2(){return o.jsx(R0,{subheading:"Get a POS for Just £60/month"})}o.jsx(bn,{path:"/get-kiosk",element:o.jsx(U2,{})}),o.jsx(bn,{path:"/get-pos",element:o.jsx(P2,{})})';
if (!routeScriptText(bundle, "/get-kiosk").includes("£199")) throw new Error("kiosk price was not read from the script");
if (!routeScriptText(bundle, "/get-pos").includes("£60")) throw new Error("POS price was not read from the script");
if (routeScriptText(bundle, "/get-pos").includes("£199")) throw new Error("kiosk price was attached to the POS page");
const thin = readablePageText({ html: "<html><body><div id=\"root\"></div></body></html>", pathname: "/get-kiosk", scripts: [bundle] });
if (!thin.text.includes("£199")) throw new Error("thin page did not use the script");
const priced = dropInventedPrices("Plans start at £39 a month. Kiosks are £199 a month.", "Get a POS for Just £199/month");
if (priced.includes("£39") || !priced.includes("£199")) throw new Error("an invented price was kept");
if (!scriptRoutes(bundle).includes("/get-kiosk")) throw new Error("script route missing");
const greeting = interviewerGreeting({ campaignName: "Solar", prospectName: "Lee Nazari", personaOverride: null, promptOverride: null, maxMinutes: null, documents: notes, opener: "Welcome to the company. Let me tell you everything about our history and then a tip about muting." });
if (greeting !== "Hi Lee, thanks for joining. What brings you here today?") throw new Error(`greeting was too long: ${greeting}`);
if (/tip|mute|solar/i.test(greeting)) throw new Error("greeting included a pitch or a tip");

console.log("interviewer owner and prompt checks passed");
