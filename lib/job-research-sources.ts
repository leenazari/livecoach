export type JobResearchSignal = {
  role: string;
  location: string;
  compensation: string;
  recency: string;
  sourceUrl: string;
};

export type VerifiedJobResearchEvidence = {
  jobBoardUrl: string;
  jobSignals: JobResearchSignal[];
};

type CampaignResearchContract = {
  name?: unknown;
  audience?: unknown;
  goal?: unknown;
  offerAngle?: unknown;
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
  const raw = String(value || "").trim();
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol)) return false;
  } catch {
    return false;
  }
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
      compensation: clean(item?.compensation, 120),
      recency: clean(item?.recency, 120),
      sourceUrl,
    });
  }
  return signals.slice(0, 4);
}

export function isCandidatePreparationCampaign(
  contract: CampaignResearchContract
): boolean {
  const text = [contract.name, contract.audience, contract.goal, contract.offerAngle]
    .map((value) => clean(value, 1_200).toLowerCase())
    .join(" ");
  const candidateContext = /\b(?:candidate|candidates|recruiter|recruiters|recruitment)\b/.test(text);
  const preparationOffer = /\b(?:prepar\w*|train\w*|mock interviews?|practice interviews?|candidate readiness)\b/.test(text);
  return candidateContext && preparationOffer;
}

function maximumPublishedCompensation(value: string): number {
  const matches = value.replace(/,/g, "").match(/\d+(?:\.\d+)?\s*[kK]?/g) || [];
  return matches.reduce((maximum, match) => {
    const thousands = /[kK]/.test(match);
    const amount = Number.parseFloat(match.replace(/[kK\s]/g, ""));
    if (!Number.isFinite(amount)) return maximum;
    return Math.max(maximum, thousands ? amount * 1_000 : amount);
  }, 0);
}

export function candidatePreparationJobScore(signal: JobResearchSignal): number {
  const role = signal.role.toLowerCase();
  let score = 0;
  if (/\b(?:software|engineering|engineer|developer|devops|cloud|data|cyber|security|technical|technology|architect|machine learning|artificial intelligence|ai|infrastructure|platform|systems?|qa|automation|product)\b/.test(role)) {
    score += 70;
  }
  if (/\b(?:medical|clinical|legal|finance|financial|compliance|actuarial|quantitative|scientist)\b/.test(role)) {
    score += 35;
  }
  if (/\b(?:chief|head|director|vice president|vp|principal|lead|senior|manager|architect)\b/.test(role)) {
    score += 20;
  }
  const compensation = maximumPublishedCompensation(signal.compensation);
  if (compensation >= 120_000) score += 25;
  else if (compensation >= 90_000) score += 20;
  else if (compensation >= 60_000) score += 12;
  else if (compensation >= 40_000) score += 6;
  return score;
}

export function rankCandidatePreparationJobSignals(
  signals: JobResearchSignal[]
): JobResearchSignal[] {
  return signals
    .map((signal, index) => ({ signal, index, score: candidatePreparationJobScore(signal) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ signal }) => signal);
}

export function conciseJobSignal(signal: JobResearchSignal): string {
  return [signal.role, signal.location, signal.compensation, signal.recency]
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

const JOB_BOARD_PATH_PARTS = new Set([
  "career",
  "careers",
  "job",
  "jobs",
  "join-us",
  "opportunities",
  "roles",
  "vacancies",
  "work-with-us",
]);

function jobBoardSourceScore(source: { url?: unknown; title?: unknown }): number {
  const raw = clean(source?.url, 1200);
  if (!raw) return -1;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return -1;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const parts = parsed.pathname
    .toLowerCase()
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const title = clean(source?.title, 240).toLowerCase();
  let score = /\b(?:careers|jobs|open roles|opportunities|vacancies)\b/.test(title)
    ? 35
    : 0;

  if (parts.length === 1 && JOB_BOARD_PATH_PARTS.has(parts[0])) score += 120;
  if (parts.length === 2 && JOB_BOARD_PATH_PARTS.has(parts[1])) score += 110;
  if (
    parts.length === 2 &&
    JOB_BOARD_PATH_PARTS.has(parts[0]) &&
    /^(?:all|open|search)$/.test(parts[1])
  ) {
    score += 105;
  }

  const publicAts = PUBLIC_JOB_SOURCE_DOMAINS.some((domain) =>
    isSameOrSubdomain(hostname, domain)
  );
  if (publicAts) {
    const obviousVacancy =
      parts.includes("j") ||
      (parts.includes("jobs") && parts.length > 2) ||
      (parts.includes("job") && parts.length > 1);
    if (obviousVacancy) return -1;
    if (parts.length === 1) score += 95;
    else if (parts.length === 2) score += 75;
  }

  // A company URL such as /job/head-of-product is a vacancy, not its jobs
  // index. We never manufacture the parent URL because the exact source may
  // not exist or may use different routing.
  if (
    parts.length > 1 &&
    (parts[0] === "job" ||
      (parts[0] === "jobs" && !/^(?:all|open|search)$/.test(parts[1])))
  ) {
    return -1;
  }
  return score;
}

export function officialJobBoardUrl<T extends { url?: unknown; title?: unknown }>(
  sources: T[],
  prospect: { website?: unknown; company_domain?: unknown }
): string {
  return officialResearchSources(sources, prospect)
    .map((source, index) => ({
      index,
      score: jobBoardSourceScore(source),
      url: clean(source?.url, 1200),
    }))
    .filter((source) => source.score >= 70)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]
    ?.url || "";
}

export function verifiedJobResearchEvidence(
  research: unknown,
  sources: Array<{ url?: unknown; title?: unknown }>,
  prospect: { website?: unknown; company_domain?: unknown }
): VerifiedJobResearchEvidence {
  const record = research && typeof research === "object"
    ? research as Record<string, any>
    : {};
  const jobBoardUrl = officialJobBoardUrl(
    [
      ...(record.jobBoardUrl
        ? [{ url: record.jobBoardUrl, title: "Official company jobs" }]
        : []),
      ...(Array.isArray(sources) ? sources : []),
    ],
    prospect
  );
  return {
    jobBoardUrl,
    jobSignals: sanitiseJobResearchSignals(record.jobSignals, prospect),
  };
}

export const VERIFIED_PUBLIC_JOB_SOURCE_DOMAINS = [
  ...PUBLIC_JOB_SOURCE_DOMAINS,
];
