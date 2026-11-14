import "server-only";

import { requireInterviewerOwner, interviewerOwnerError } from "@/lib/interviewer/access";
import {
  findFactClashes,
  keepCitedClashes,
  type ClashKind,
  type FactClash,
} from "@/lib/interviewer/fact-clash";
import { KNOWLEDGE_SECTIONS, emptyKnowledge, type KnowledgeSectionKey } from "@/lib/interviewer/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = new Set<ClashKind>(["price", "hours", "phone", "product", "feature", "contract"]);

function asSections(value: unknown): Record<KnowledgeSectionKey, string> {
  const next = emptyKnowledge();
  if (!value || typeof value !== "object") return next;
  const record = value as Record<string, unknown>;
  for (const section of KNOWLEDGE_SECTIONS) next[section.key] = String(record[section.key] || "");
  return next;
}

function sectionFor(quote: string, source: Record<KnowledgeSectionKey, string>): KnowledgeSectionKey {
  const found = KNOWLEDGE_SECTIONS.find((section) => (source[section.key] || "").toLowerCase().includes(quote.toLowerCase()));
  return found?.key || "summary";
}

async function askModel(brochure: string, website: string): Promise<FactClash[]> {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) return [];
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Compare two sources. Return JSON {"clashes":[{"kind":"price|hours|phone|product|feature|contract","brochure":"","website":""}]}.
Only include a clash when the same kind of fact is stated in both sources and the two statements disagree.
brochure must be copied exactly from the brochure text. website must be copied exactly from the website text.
If a fact is in only one source, omit it. Do not invent a price, name, hour, phone number, product, feature, or term.`,
        },
        { role: "user", content: `BROCHURE\n${brochure.slice(0, 12000)}\n\nWEBSITE\n${website.slice(0, 12000)}` },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) return [];
  const payload = await response.json();
  const parsed = JSON.parse(payload?.choices?.[0]?.message?.content || "{}") as { clashes?: Array<{ kind?: string; brochure?: string; website?: string }> };
  return (parsed.clashes || []).flatMap((clash, index) => {
    const kind = String(clash.kind || "") as ClashKind;
    const left = String(clash.brochure || "").trim();
    const right = String(clash.website || "").trim();
    if (!KINDS.has(kind) || !left || !right) return [];
    return [{ id: `model-${kind}-${index}`, kind, section: "summary" as KnowledgeSectionKey, brochure: left, website: right }];
  });
}

export async function POST(req: Request) {
  try {
    await requireInterviewerOwner();
    const body = await req.json().catch(() => ({}));
    const brochure = asSections(body.brochure);
    const website = asSections(body.website);
    const brochureText = KNOWLEDGE_SECTIONS.map((section) => brochure[section.key]).join("\n");
    const websiteText = KNOWLEDGE_SECTIONS.map((section) => website[section.key]).join("\n");
    const deterministic = findFactClashes(brochure, website);
    let model: FactClash[] = [];
    try {
      model = await askModel(brochureText, websiteText);
    } catch { /* the exact matches below still stand */ }
    const cited = keepCitedClashes(model, brochureText, websiteText).map((clash) => ({
      ...clash,
      section: sectionFor(clash.brochure, brochure),
    }));
    const seen = new Set<string>();
    const clashes = [...deterministic, ...cited].filter((clash) => {
      const key = `${clash.brochure}|${clash.website}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return Response.json({ clashes }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
