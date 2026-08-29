export type BrainOutreachReferenceProspect = {
  id?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  research?: unknown;
  last_researched_at?: string | null;
};

const STOP_WORDS = new Set([
  "about",
  "could",
  "did",
  "find",
  "from",
  "have",
  "how",
  "know",
  "outreach",
  "said",
  "that",
  "the",
  "there",
  "this",
  "what",
  "where",
  "which",
  "with",
  "you",
]);

function normal(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9@.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
    : [];
}

function researchObject(value: unknown): Record<string, any> {
  return value && typeof value === "object"
    ? (value as Record<string, any>)
    : {};
}

function researchText(value: unknown) {
  const research = researchObject(value);
  return normal(
    [
      research.personalisationFact,
      research.summary,
      research.freshness,
      ...stringArray(research.signals),
      ...stringArray(research.activeJobs),
      ...(Array.isArray(research.jobSignals)
        ? research.jobSignals.flatMap((signal: any) => [
            signal?.role,
            signal?.location,
            signal?.recency,
          ])
        : []),
    ].join(" ")
  );
}

function includesNameToken(words: Set<string>, value: unknown) {
  const candidate = normal(value);
  return candidate.length >= 3 && words.has(candidate);
}

export function rankNamedOutreachProspects<T extends BrainOutreachReferenceProspect>(
  message: string,
  prospects: T[],
  limit = 3
): T[] {
  const needle = normal(message);
  const words = new Set(needle.split(" ").filter(Boolean));
  const messageTerms = [...words].filter(
    (word) => word.length >= 3 && !STOP_WORDS.has(word)
  );
  const asksAboutJobs =
    /\b(job|jobs|role|roles|vacancy|vacancies|hiring|recruiting|post|listing|listings)\b/.test(
      needle
    );

  return prospects
    .map((prospect, index) => {
      const email = normal(prospect.email);
      const firstName = normal(prospect.first_name);
      const lastName = normal(prospect.last_name);
      const fullName = normal(
        `${prospect.first_name || ""} ${prospect.last_name || ""}`
      );
      const company = normal(prospect.company_name);
      let score = 0;

      if (email.length >= 6 && needle.includes(email)) score += 1_000;
      if (fullName.includes(" ") && needle.includes(fullName)) score += 900;
      if (company.length >= 4 && needle.includes(company)) score += 800;
      if (
        company
          .split(" ")
          .some((word) => word.length >= 4 && words.has(word))
      )
        score += 300;
      if (includesNameToken(words, lastName)) score += 180;
      if (includesNameToken(words, firstName)) score += 100;
      if (!score) return null;

      if (lastName) score += 5;
      const research = researchObject(prospect.research);
      const savedResearch = researchText(research);
      const activeJobs = stringArray(research.activeJobs);
      const jobSignals = Array.isArray(research.jobSignals)
        ? research.jobSignals.filter(Boolean)
        : [];

      if (asksAboutJobs) {
        if (activeJobs.length) score += 240;
        if (jobSignals.length) score += 240;
        if (
          /\b(live|current|recent)\b/.test(savedResearch) &&
          /\b(job|jobs|role|roles|vacancy|vacancies|listing|listings)\b/.test(
            savedResearch
          )
        )
          score += 80;
        if (/\bno (?:current|live|verified)\b/.test(savedResearch)) score -= 40;
      }

      const overlap = messageTerms.filter((term) =>
        savedResearch.includes(term)
      ).length;
      score += overlap * 12;

      const researchedAt = Date.parse(prospect.last_researched_at || "") || 0;
      return { prospect, score, researchedAt, index };
    })
    .filter(
      (
        row
      ): row is { prospect: T; score: number; researchedAt: number; index: number } =>
        !!row
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.researchedAt - a.researchedAt ||
        a.index - b.index
    )
    .slice(0, Math.max(1, limit))
    .map((row) => row.prospect);
}

export function compactOutreachResearchFacts(
  value: unknown,
  limit = 4
): string[] {
  const research = researchObject(value);
  const facts: string[] = [];
  const personalisationFact = String(
    research.personalisationFact || ""
  ).trim();
  if (personalisationFact) facts.push(personalisationFact);

  const activeJobs = stringArray(research.activeJobs).slice(0, 3);
  if (activeJobs.length) facts.push(`Active roles: ${activeJobs.join(" | ")}`);

  const freshness = String(research.freshness || "").trim();
  if (freshness) facts.push(`Source check: ${freshness}`);

  const summary = String(research.summary || "").trim();
  if (summary && !facts.includes(summary)) facts.push(summary);

  return facts.slice(0, Math.max(1, limit));
}
