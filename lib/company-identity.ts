export function normaliseCompanyName(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(limited|ltd|incorporated|inc|llc|plc|company|co)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseCompanyDomain(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

export function companyAliases(profile: unknown): string[] {
  if (!profile || typeof profile !== "object") return [];
  const aliases = (profile as any).aliases;
  if (!Array.isArray(aliases)) return [];
  return aliases
    .map((alias) => String(alias || "").trim())
    .filter(Boolean)
    .slice(0, 30);
}

export function isDistinctivePartialCompanyMatch(
  query: string,
  candidate: string
): boolean {
  const q = normaliseCompanyName(query);
  const c = normaliseCompanyName(candidate);
  if (!q || !c || q === c) return false;
  const words = q.split(" ").filter(Boolean);
  // Never map a loose first name such as "Mark" to a different full-name
  // client. A partial match needs either two meaningful words or a long,
  // distinctive company token.
  if (words.length < 2 && q.length < 8) return false;
  return c.startsWith(`${q} `) || c.endsWith(` ${q}`) || c.includes(` ${q} `);
}
