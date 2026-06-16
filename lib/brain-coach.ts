// The success coach's core: its mission, posture, and the curriculum it works
// through. Shared by the brain interview (and, later, the proactive growth
// engine) so the coach reasons the same way everywhere.

// The North Star and how the coach behaves. Prepended to the coach's thinking
// prompts (on top of the workspace brain block).
export function coachSystemBlock(): string {
  return `YOU ARE LEE'S SUCCESS COACH. Your job is to get Lee to a personal millionaire outcome within 12 months by building a successful business. The concrete scoreboard: raise ai13 / Interviewa (or a strong new venture) to at least £5M on paper, which needs roughly £650k revenue across the businesses, on a 12 month clock starting July. Judge every question, idea and nudge by one test: does this move Lee measurably closer to that target.

HOW YOU OPERATE:
- High initiative and genuinely on Lee's side. Bring energy, ambition and the sharpest ideas you can. Think like a co-founder who owns the outcome.
- Honest, never sycophantic. You earn trust by being right, not by flattering. Push back, name the hard truth, and tell Lee plainly when his favourite idea is the weak one or when he is about to make a mistake. Pleasing Lee means making him win, not telling him what he wants to hear.
- Ruthlessly ethical. Pursue every opportunity the honest, durable way. No manipulation, no deception, never trade reputation or relationships for a short term win. If a tactic is effective but shady, say so and give the clean alternative.
- Grounded. Reason only from what you actually know about Lee and the business, and from real data when you research it. Never invent facts, numbers, dates or trends. If something is unknown, say so and treat learning it as the move.
- Plain English. No markdown, no em dashes or semicolons.`;
}

export type Topic = { key: string; title: string; focus: string };

// The syllabus the coach works through, in importance order. Earlier topics are
// the ones that most move the £5M / £650k goal, so the question picker prefers
// them when coverage is thin.
export const CURRICULUM: Topic[] = [
  { key: "money", title: "The money", focus: "how revenue is made now, margins, runway, the path to £650k revenue and a £5M valuation, what 'rich' means to Lee in take-home" },
  { key: "company", title: "ai13 / Interviewa", focus: "what the product does, real traction, the genuine edge, what is and is not working" },
  { key: "icp", title: "Ideal customer and market", focus: "exactly who buys, why, where demand is hottest, which segment to dominate first" },
  { key: "sales", title: "Sales motion", focus: "how deals are actually won today, the path from intro to close, where they stall and why" },
  { key: "pricing", title: "Pricing and packaging", focus: "current pricing, what works, where money is being left on the table" },
  { key: "ventures", title: "Ventures and bets", focus: "KIN and any other bets, stage, thesis, what success looks like, whether they help or distract from the goal" },
  { key: "competitors", title: "Competitors and positioning", focus: "who else is in the space, why Lee wins or loses, the sharpest positioning" },
  { key: "network", title: "Network and leverage", focus: "who Lee already knows that he is under-using (e.g. Steve Smith, Darren), and how to activate them" },
  { key: "you", title: "Who Lee is", focus: "Lee's background, strengths, how he works best, what drains him, so the plan fits the operator" },
  { key: "goals", title: "Goals and constraints", focus: "the 3, 6 and 12 month targets, and the real limits: time, cash, team" },
];

export type Coverage = Record<string, "unknown" | "partial" | "solid">;

export function normaliseCoverage(raw: any): Coverage {
  const out: Coverage = {};
  const valid = new Set(["unknown", "partial", "solid"]);
  for (const t of CURRICULUM) {
    const v = raw && typeof raw === "object" ? raw[t.key] : undefined;
    out[t.key] = valid.has(v) ? v : "unknown";
  }
  return out;
}

// Pick the next N topics to ask about: the thinnest first (unknown before
// partial before solid), then in curriculum importance order. So the coach
// always drills the highest-impact gap it hasn't filled yet.
export function pickTopics(coverage: Coverage, n = 4): Topic[] {
  const rank = (k: string) =>
    coverage[k] === "unknown" ? 0 : coverage[k] === "partial" ? 1 : 2;
  return [...CURRICULUM]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t.key) - rank(b.t.key) || a.i - b.i)
    .slice(0, n)
    .map((x) => x.t);
}

// Match a topic key to a free-text question/answer (best-effort), so an answer
// can advance the right topic's coverage. Falls back to the title words.
export function topicForText(text: string): string | null {
  const t = (text || "").toLowerCase();
  let best: { key: string; score: number } | null = null;
  for (const topic of CURRICULUM) {
    const words = `${topic.title} ${topic.focus}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4);
    let score = 0;
    for (const w of words) if (t.includes(w)) score++;
    if (!best || score > best.score) best = { key: topic.key, score };
  }
  return best && best.score > 0 ? best.key : null;
}
