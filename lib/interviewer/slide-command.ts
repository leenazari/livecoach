const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const NUMBER = "\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
const TOOL_DUMP = /show\s*slide\s*\{[^}]*\}/gi;
const COMMAND = new RegExp(`\\b(?:(?:please\\s+)?(?:show|go\\s+to|switch\\s+to|move\\s+to|open|display)\\s+)?slide\\s+(?:number\\s+)?(${NUMBER})\\b`, "gi");
const INCOMPLETE = new RegExp(`(?:\\b(?:please\\s+)?(?:show|go\\s+to|switch\\s+to|move\\s+to|open|display)\\s+)?\\bslide(?:\\s+(?:number\\s+)?)?(?:\\d{0,2}|[a-z]{0,9})?$`, "i");

export function spokenSlideNumber(token: string): number | null {
  const value = token.trim().toLowerCase();
  if (/^\d{1,2}$/.test(value)) {
    const number = Number(value);
    return number >= 1 ? number : null;
  }
  return WORD_NUMBERS[value] || null;
}

export function takeSpokenSlideCommands(value: string): { text: string; slides: number[] } {
  const slides: number[] = [];
  const withoutTools = String(value || "").replace(TOOL_DUMP, (block) => {
    const number = block.match(/slide_?number["']?\s*[:=]\s*"?(\d{1,2})/i);
    const parsed = number ? spokenSlideNumber(number[1]) : null;
    if (parsed) slides.push(parsed);
    return " ";
  });
  const text = withoutTools.replace(COMMAND, (phrase, token: string) => {
    const number = spokenSlideNumber(token);
    if (!number) return phrase;
    slides.push(number);
    return " ";
  });
  return {
    text: text.replace(/\s+([,.!?])/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/\s+\n/g, "\n").trim(),
    slides,
  };
}

export function incompleteSlideCommand(value: string): number {
  const match = String(value || "").match(INCOMPLETE);
  if (!match?.[0]) return 0;
  if (takeSpokenSlideCommands(match[0]).slides.length) return 0;
  return match[0].length;
}
