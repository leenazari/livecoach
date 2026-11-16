import { KNOWLEDGE_SECTIONS, type KnowledgeSectionKey, emptyKnowledge } from "./knowledge";

export type ClashKind = "price" | "hours" | "phone" | "product" | "feature" | "contract";

export type FactClash = {
  id: string;
  kind: ClashKind;
  section: KnowledgeSectionKey;
  brochure: string;
  website: string;
};

export type ResolvedClash = FactClash & {
  choice: "brochure" | "website" | "custom" | "unconfirmed";
  custom?: string;
};

const PRICE = /(?:£|\$|€)\s?\d[\d,]*(?:\.\d{1,2})?/gi;
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(?0\d{2,4}\)?[\s-]?)?\d[\d\s()-]{6,}\d/g;
const HOURS = /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b[^.]{0,48}\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi;

function normal(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function sentenceWith(text: string, fact: string): string {
  const parts = text.split(/(?<=[.!?])\s+/);
  const found = parts.find((part) => part.toLowerCase().includes(fact.toLowerCase()));
  return (found || fact).replace(/\s+/g, " ").trim().slice(0, 400);
}

function facts(text: string, pattern: RegExp): string[] {
  return [...new Set((text.match(pattern) || []).map((item) => item.replace(/\s+/g, " ").trim()))];
}

function pairClashes(kind: ClashKind, brochureText: string, websiteText: string, section: KnowledgeSectionKey): FactClash[] {
  const pattern = kind === "price" ? PRICE : kind === "phone" ? PHONE : HOURS;
  const left = facts(brochureText, pattern);
  const right = facts(websiteText, pattern);
  const missingOnSite = left.filter((item) => !right.some((other) => normal(other) === normal(item)));
  const missingOnBrochure = right.filter((item) => !left.some((other) => normal(other) === normal(item)));
  if (!missingOnSite.length || !missingOnBrochure.length) return [];
  return missingOnSite.slice(0, 4).map((item, index) => {
    const other = missingOnBrochure[index] || missingOnBrochure[0];
    return {
      id: `${kind}-${section}-${index}`,
      kind,
      section,
      brochure: sentenceWith(brochureText, item),
      website: sentenceWith(websiteText, other),
    };
  });
}

export function findFactClashes(
  brochure: Record<KnowledgeSectionKey, string>,
  website: Record<KnowledgeSectionKey, string>,
): FactClash[] {
  const clashes: FactClash[] = [];
  for (const section of KNOWLEDGE_SECTIONS) {
    const left = brochure[section.key] || "";
    const right = website[section.key] || "";
    if (!left.trim() || !right.trim()) continue;
    clashes.push(...pairClashes("price", left, right, section.key));
    clashes.push(...pairClashes("phone", left, right, section.key));
    clashes.push(...pairClashes("hours", left, right, section.key));
  }
  const seen = new Set<string>();
  return clashes.filter((clash) => {
    const key = `${clash.brochure}|${clash.website}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return clash.brochure !== clash.website;
  });
}

export function keepCitedClashes(
  clashes: FactClash[],
  brochure: string,
  website: string,
): FactClash[] {
  return clashes.filter((clash) => {
    const kinds: ClashKind[] = ["price", "hours", "phone", "product", "feature", "contract"];
    return kinds.includes(clash.kind)
      && brochure.toLowerCase().includes(clash.brochure.toLowerCase())
      && website.toLowerCase().includes(clash.website.toLowerCase())
      && clash.brochure.trim() !== clash.website.trim();
  });
}

export function mergeKnowledge(
  brochure: Record<KnowledgeSectionKey, string>,
  website: Record<KnowledgeSectionKey, string>,
  clashes: ResolvedClash[],
): Record<KnowledgeSectionKey, string> {
  const next = emptyKnowledge();
  for (const section of KNOWLEDGE_SECTIONS) {
    let text = (brochure[section.key] || "").trim();
    const web = (website[section.key] || "").trim();
    for (const clash of clashes.filter((item) => item.section === section.key)) {
      const chosen = clash.choice === "website"
        ? clash.website
        : clash.choice === "custom"
          ? (clash.custom || "").trim()
          : clash.choice === "unconfirmed"
            ? `Unconfirmed, do not quote. Brochure says ${clash.brochure} Website says ${clash.website}`
            : clash.brochure;
      text = text.includes(clash.brochure) ? text.replace(clash.brochure, chosen) : `${text}\n${chosen}`.trim();
    }
    for (const sentence of web.split(/(?<=[.!?])\s+/)) {
      const line = sentence.trim();
      if (!line || text.includes(line)) continue;
      if (clashes.some((clash) => clash.section === section.key && (clash.website.includes(line) || line.includes(clash.website)))) continue;
      text = `${text}\n${line}`.trim();
    }
    next[section.key] = text.trim();
  }
  return next;
}
