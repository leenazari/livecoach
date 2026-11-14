const SMALL = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function integerWords(value: number): string {
  if (value < 20) return SMALL[value];
  if (value < 100) {
    const rest = value % 10;
    return rest ? `${TENS[Math.floor(value / 10)]} ${SMALL[rest]}` : TENS[Math.floor(value / 10)];
  }
  if (value < 1000) {
    const rest = value % 100;
    const head = `${SMALL[Math.floor(value / 100)]} hundred`;
    return rest ? `${head} and ${integerWords(rest)}` : head;
  }
  if (value < 10000) {
    const rest = value % 1000;
    const head = `${integerWords(Math.floor(value / 1000))} thousand`;
    return rest ? `${head} ${integerWords(rest)}` : head;
  }
  return String(value);
}

function speakPrice(match: string, pounds: string, pence?: string): string {
  const amount = Number(pounds.replace(/,/g, ""));
  if (!Number.isInteger(amount) || amount < 0 || amount > 9999) return match.replace(/£/g, "");
  const month = /month/i.test(match);
  const words = `${integerWords(amount)} pound${amount === 1 ? "" : "s"}`;
  const penceAmount = pence ? Number(pence.padEnd(2, "0")) : 0;
  const penceWords = penceAmount ? ` and ${integerWords(penceAmount)} pence` : "";
  return `${words}${penceWords}${month ? " a month" : ""}`;
}

// Plain sentences for the voice and the on-screen transcript. Markup is removed
// so it cannot be read aloud as "star" or "hash".
export function toSpokenPlain(value: string): string {
  let text = String(value || "").replace(/\r/g, "");
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/gi, "$1");
  text = text.replace(/https?:\/\/\S+/gi, "");
  text = text.replace(/£\s?(\d[\d,]*)(?:\.(\d{1,2}))?\s*(?:(?:a|per)\s+month|\/\s*month)?/gi, speakPrice);
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1$2");
  text = text.replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1$2");
  text = text.replace(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/gm, (_, item: string) => {
    const sentence = String(item).trim().replace(/[.!;,]+$/, "");
    return sentence ? `${sentence}.` : "";
  });
  text = text.replace(/[*#`_•]/g, "");
  text = text.replace(/\p{Extended_Pictographic}/gu, "");
  text = text.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  return text.trim();
}
