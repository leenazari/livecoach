const OBJECTION_TITLES = [
  "Too expensive",
  "We already have a solution",
  "I do not trust it to be accurate",
  "We do not have time to set it up",
  "Does it integrate",
  "What about our data",
  "I need to think about it",
  "Not right now",
  "What if it does not work for us",
  "The decision maker is not here",
  "We are too small",
  "Can it cover the hours we are closed",
];

function sentenceWith(source: string, pattern: RegExp): string {
  const found = source.split(/(?<=[.!?])\s+/).find((line) => pattern.test(line));
  return found ? found.replace(/\s+/g, " ").trim() : "";
}

export function objectionNoteFromSource(source: string): string {
  const text = String(source || "").replace(/\s+/g, " ").trim();
  const price = text.match(/(?:£|\$|€)\s?\d[\d,]*(?:\.\d{1,2})?(?:\s*\/\s*month|\s+a\s+month|\s+per\s+month)?/i)?.[0] || "";
  const answers = [
    price
      ? `The price written down is ${price}. I will not add fees that are not written. Shall I show how that sits against what you do today?`
      : "I will not guess a price. The team can tailor a plan when you see it. Would a short demo help?",
    "If you already have something, we only look at the gap you just described. What does that tool fail to do?",
    "I will only say what is written in the brochure or on the site. If it is not there, I will ask the team to confirm. Which fact worries you most?",
    sentenceWith(text, /train|setup|deploy|minutes/i)
      ? `${sentenceWith(text, /train|setup|deploy|minutes/i)} The team handles the setup. When would you want it in place?`
      : "The team handles the setup from your own material. When would you want it in place?",
    "I will only claim an integration that is written down. Which system would it need to meet?",
    "I will not invent a security claim. If it is not written in the notes, the team confirms it on a call. What do you need confirmed?",
    "That is fair. I can send nothing you have not asked for. Would a short demo be a better next step than a long email?",
    "We can leave the timing with you. Is there a month you are aiming for?",
    "We can agree one success number up front, then review it. What single result would make this worth it?",
    "We can include them when you are ready. Who else would need to see it?",
    "Smaller teams use the same notes. How many people deal with customers today?",
    sentenceWith(text, /24\/7|out of hours|always/i)
      ? `${sentenceWith(text, /24\/7|out of hours|always/i)} Does that cover the hours you miss today?`
      : "I will only promise hours that are written down. Which hours are you uncovered?",
  ];
  const lines = OBJECTION_TITLES.map((title, index) => `${title}.\n${answers[index]}`);
  return lines.join("\n\n");
}

export function missingKnowledgeTitles(existing: string[]): string[] {
  const have = new Set(existing.map((title) => title.trim().toLowerCase()));
  return ["Business summary", "Products and services", "Pricing", "FAQs and objections", "Next step and booking", "Objection handling", "Qualifying questions"]
    .filter((title) => !have.has(title.toLowerCase()));
}
