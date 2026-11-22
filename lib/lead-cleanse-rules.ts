export const CLEANSE_BATCH_SIZE = 8;
export const CLEANSE_MAX_BATCHES = 4;
export const CLEANSE_MAX_OUTPUT_TOKENS = 700;
export const CLEANSE_MAX_INPUT_CHARS = 12000;

export const CLEANSE_SYSTEM = [
  "You check rows in a lead bank before anyone uses them.",
  "For each id, set status to passed or failed and give one short reason.",
  "Fail the row when the business name is not a real company, the website does not match the company, the email domain is not a plausible match for the company, the contact name is a job title or a placeholder rather than a person, the sector or city does not fit the other fields, or the row is junk or a duplicate of another row in this batch.",
  "Pass the row when it looks like a real business and a real person.",
  "Use at most 12 words in the reason. Do not invent missing facts.",
].join(" ");

export const CLEANSE_RESPONSE_FORMAT = {
  type: "json_schema",
  name: "lead_bank_cleanse",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "status", "reason"],
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["passed", "failed"] },
            reason: { type: "string" },
          },
        },
      },
    },
  },
};

export type CleanseLead = {
  id: string;
  company: string;
  website: string;
  domain: string;
  email: string;
  contactName: string;
  sector: string;
  city: string;
  area: string;
  createdAt: string;
};

export type CleanseVerdict = {
  id: string;
  status: "passed" | "failed";
  reason: string;
};

export type CleanseDecisionDraft = {
  reason: string;
  countBefore: number;
  countAfter: number;
  modelCostUsd: number;
};

export type CleansePublicResult = {
  ok: true;
  skipped?: "disabled" | "outside_london_window";
  read: number;
  pendingCount: number;
  passed: number;
  failed: number;
  leftPending: number;
  updatesSaved: number;
  updatesAttempted: number;
  decisionLogged: boolean;
  modelCostUsd: number;
  note: string;
};

export function leadCleanseEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.LEAD_CLEANSE_ENABLED === "true";
}

export function londonHour(now: Date) {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .find((part) => part.type === "hour")?.value;
  const value = Number(hour);
  return value === 24 ? 0 : value;
}

export function isLeadCleanseWindow(now: Date) {
  return londonHour(now) === 2;
}

const clip = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 160);

export function domainKey(lead: Pick<CleanseLead, "domain" | "website">) {
  const explicit = lead.domain.trim().toLowerCase().replace(/^www\./, "");
  if (explicit) return explicit;
  const raw = lead.website.trim();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function compactCleanseLead(lead: CleanseLead) {
  return {
    id: lead.id,
    company: clip(lead.company),
    website: clip(lead.website),
    domain: clip(lead.domain || domainKey(lead)),
    email: clip(lead.email),
    contactName: clip(lead.contactName),
    sector: clip(lead.sector),
    city: clip(lead.city),
    area: clip(lead.area),
  };
}

export function splitDuplicateLeads(leads: CleanseLead[]) {
  const ordered = [...leads].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const seenDomains = new Set<string>();
  const seenCompanies = new Set<string>();
  const unique: CleanseLead[] = [];
  const duplicates: CleanseVerdict[] = [];
  for (const lead of ordered) {
    const domain = domainKey(lead);
    const company = lead.company.trim().toLowerCase();
    const companyKey = company && lead.city.trim() ? `${company}|${lead.city.trim().toLowerCase()}` : "";
    const domainDup = domain && seenDomains.has(domain);
    const companyDup = companyKey && seenCompanies.has(companyKey);
    if (domainDup || companyDup) {
      duplicates.push({ id: lead.id, status: "failed", reason: "Duplicate of another bank lead." });
      continue;
    }
    if (domain) seenDomains.add(domain);
    if (companyKey) seenCompanies.add(companyKey);
    unique.push(lead);
  }
  return { unique, duplicates };
}

export function fitCleanseBatch<T>(leads: T[], maxChars = CLEANSE_MAX_INPUT_CHARS) {
  const fitted: T[] = [];
  for (const lead of leads) {
    if (fitted.length && JSON.stringify([...fitted, lead]).length > maxChars) break;
    fitted.push(lead);
    if (JSON.stringify(fitted).length > maxChars) break;
  }
  return fitted;
}

const reasonFor = (status: "passed" | "failed", value: unknown) => {
  const reason = clip(String(value ?? ""));
  if (reason) return reason;
  return status === "failed" ? "Failed the bank check." : "Looks like a real business.";
};

export function parseCleanseVerdicts(text: string, allowedIds: Set<string>): CleanseVerdict[] {
  const raw = text.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const results = parsed && typeof parsed === "object" ? (parsed as { results?: unknown }).results : null;
  if (!Array.isArray(results)) return [];
  const seen = new Set<string>();
  const verdicts: CleanseVerdict[] = [];
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const id = String((row as { id?: unknown }).id || "");
    const status = (row as { status?: unknown }).status;
    if (!allowedIds.has(id) || seen.has(id)) continue;
    if (status !== "passed" && status !== "failed") continue;
    seen.add(id);
    verdicts.push({ id, status, reason: reasonFor(status, (row as { reason?: unknown }).reason) });
  }
  return verdicts;
}

export function toCleanseDecisionRow(draft: CleanseDecisionDraft, runId: string) {
  // step 'cleanse' is allowed on adam_bank_decisions. campaign and criteria_set
  // are the literal 'cleanse', not a lead campaign code.
  return {
    run_id: runId,
    campaign: "cleanse",
    criteria_set: "cleanse",
    step: "cleanse",
    count_before: draft.countBefore,
    count_after: draft.countAfter,
    apify_run_id: "",
    apify_cost_usd: 0,
    model_cost_usd: draft.modelCostUsd,
    reason: draft.reason,
  };
}

const skipped = (kind: "disabled" | "outside_london_window", note: string): CleansePublicResult => ({
  ok: true,
  skipped: kind,
  read: 0,
  pendingCount: 0,
  passed: 0,
  failed: 0,
  leftPending: 0,
  updatesSaved: 0,
  updatesAttempted: 0,
  decisionLogged: false,
  modelCostUsd: 0,
  note,
});

export async function executeLeadCleanse(deps: {
  now: Date;
  env: NodeJS.ProcessEnv;
  loadPending: () => Promise<{ leads: CleanseLead[]; pendingCount: number }>;
  existingDomainHits: (domains: string[]) => Promise<Set<string>>;
  saveVerdict: (verdict: CleanseVerdict) => Promise<"saved" | "missed" | "error">;
  askModel: (leads: ReturnType<typeof compactCleanseLead>[]) => Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  runId: string;
  logDecision: (row: ReturnType<typeof toCleanseDecisionRow>) => Promise<boolean>;
}): Promise<CleansePublicResult> {
  if (!leadCleanseEnabled(deps.env)) {
    return skipped("disabled", "Cleanse is off. No leads were checked.");
  }
  if (!isLeadCleanseWindow(deps.now)) {
    return skipped("outside_london_window", "It is not 02:00 in the UK. No leads were checked.");
  }

  const loaded = await deps.loadPending();
  const leads = loaded.leads.slice(0, CLEANSE_BATCH_SIZE * CLEANSE_MAX_BATCHES);
  const domains = Array.from(new Set(leads.map(domainKey).filter(Boolean)));
  const existing = domains.length ? await deps.existingDomainHits(domains) : new Set<string>();
  const held = leads.filter((lead) => {
    const domain = domainKey(lead);
    return domain && existing.has(domain);
  });
  const rest = leads.filter((lead) => !held.includes(lead));
  const split = splitDuplicateLeads(rest);
  const localFails: CleanseVerdict[] = [
    ...held.map((lead) => ({
      id: lead.id,
      status: "failed" as const,
      reason: "Duplicate of another bank lead.",
    })),
    ...split.duplicates,
  ];

  let passed = 0;
  let failed = 0;
  let updatesSaved = 0;
  let updatesAttempted = 0;
  let stopped = false;
  const apply = async (verdict: CleanseVerdict) => {
    if (stopped) return;
    updatesAttempted += 1;
    const result = await deps.saveVerdict(verdict);
    if (result === "error") {
      stopped = true;
      return;
    }
    if (result !== "saved") return;
    updatesSaved += 1;
    if (verdict.status === "passed") passed += 1;
    else failed += 1;
  };

  for (const verdict of localFails) await apply(verdict);

  let modelCostUsd = 0;
  let batches = 0;
  let modelFailed = false;
  let queue = split.unique;
  while (!stopped && !modelFailed && queue.length && batches < CLEANSE_MAX_BATCHES) {
    const fitted = fitCleanseBatch(queue.slice(0, CLEANSE_BATCH_SIZE).map(compactCleanseLead));
    const ids = new Set(fitted.map((lead) => lead.id));
    queue = queue.filter((lead) => !ids.has(lead.id));
    batches += 1;
    try {
      const answer = await deps.askModel(fitted);
      modelCostUsd += Number(answer.costUsd) || 0;
      for (const verdict of parseCleanseVerdicts(answer.text, ids)) await apply(verdict);
    } catch {
      modelFailed = true;
    }
  }

  const leftPending = Math.max(0, loaded.pendingCount - passed - failed);
  const draft: CleanseDecisionDraft = {
    reason: `Passed ${passed}. Failed ${failed}. Left pending ${leftPending}.`,
    countBefore: loaded.pendingCount,
    countAfter: leftPending,
    modelCostUsd: Math.round(modelCostUsd * 10000) / 10000,
  };
  let decisionLogged = false;
  try {
    decisionLogged = await deps.logDecision(toCleanseDecisionRow(draft, deps.runId));
  } catch {
    decisionLogged = false;
  }
  const parts = [
    stopped
      ? "Some lead checks were saved. A later update did not finish. Rows still marked pending were left pending."
    : modelFailed
      ? updatesSaved
        ? "Some lead checks were saved. The model check stopped, and unchecked rows were left pending."
        : "The model check stopped before any row was updated. Unchecked rows were left pending."
        : !leads.length
          ? "No pending leads were waiting."
          : "Lead checks were saved.",
    decisionLogged
      ? "The decision log was written."
      : "The decision log was not written. Do not assume the spend line exists until you can see it.",
  ];
  return {
    ok: true,
    read: leads.length,
    pendingCount: loaded.pendingCount,
    passed,
    failed,
    leftPending,
    updatesSaved,
    updatesAttempted,
    decisionLogged,
    modelCostUsd: draft.modelCostUsd,
    note: parts.join(" "),
  };
}
