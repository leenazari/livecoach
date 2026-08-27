export type JobResearchSignal = {
  role: string;
  location: string;
  recency: string;
  sourceUrl: string;
};

const PUBLIC_JOB_SOURCE_DOMAINS = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "apply.workable.com",
  "jobs.ashbyhq.com",
  "myworkdayjobs.com",
  "jobs.smartrecruiters.com",
  "jobs.jobvite.com",
  "careers.icims.com",
  "jobs.bamboohr.com",
  "teamtailor.com",
  "jobs.personio.com",
  "jobs.personio.de",
  "recruitee.com",
  "careers-page.com",
  "pinpointhq.com",
] as const;

const clean = (value: unknown, max: number) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

export function researchHostname(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isSameOrSubdomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isLinkedInResearchUrl(value: unknown): boolean {
  const hostname = researchHostname(value);
  return isSameOrSubdomain(hostname, "linkedin.com");
}

export function officialJobSearchDomains(prospect: {
  website?: unknown;
  company_domain?: unknown;
}): string[] {
  return Array.from(
    new Set([
      researchHostname(prospect.website),
      researchHostname(prospect.company_domain),
      ...PUBLIC_JOB_SOURCE_DOMAINS,
    ].filter(Boolean))
  );
}

export function isOfficialJobResearchUrl(
  value: unknown,
  prospect: { website?: unknown; company_domain?: unknown }
): boolean {
  const hostname = researchHostname(value);
  if (!hostname || isLinkedInResearchUrl(value)) return false;
  return officialJobSearchDomains(prospect).some((domain) =>
    isSameOrSubdomain(hostname, domain)
  );
}

export function sanitiseJobResearchSignals(
  value: unknown,
  prospect: { website?: unknown; company_domain?: unknown }
): JobResearchSignal[] {
  if (!Array.isArray(value)) return [];
  const signals: JobResearchSignal[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const sourceUrl = clean(item?.sourceUrl, 1200);
    const role = clean(item?.role, 180);
    if (!role || !isOfficialJobResearchUrl(sourceUrl, prospect)) continue;
    const key = `${role.toLowerCase()}\u0000${sourceUrl.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push({
      role,
      location: clean(item?.location, 120),
      recency: clean(item?.recency, 120),
      sourceUrl,
    });
  }
  return signals.slice(0, 4);
}

export function conciseJobSignal(signal: JobResearchSignal): string {
  return [signal.role, signal.location, signal.recency]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 240);
}

export function officialResearchSources<T extends { url?: unknown }>(
  sources: T[],
  prospect: { website?: unknown; company_domain?: unknown }
): T[] {
  return (Array.isArray(sources) ? sources : [])
    .filter((source) => isOfficialJobResearchUrl(source?.url, prospect))
    .slice(0, 8);
}

export const VERIFIED_PUBLIC_JOB_SOURCE_DOMAINS = [
  ...PUBLIC_JOB_SOURCE_DOMAINS,
];
