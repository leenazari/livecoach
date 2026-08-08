import { isNearDuplicateTask } from "@/lib/tasks";

export type HealthStatus = "healthy" | "attention" | "critical";

export type HealthAction = {
  label: string;
  endpoint: string;
  method: "POST";
  confirm?: string;
};

export type HealthCheck = {
  id: string;
  title: string;
  status: HealthStatus;
  count: number;
  detail: string;
  why: string;
  href?: string;
  action?: HealthAction;
  examples?: string[];
};

export type HealthReport = {
  generatedAt: string;
  overall: HealthStatus;
  totals: Record<HealthStatus, number>;
  checks: HealthCheck[];
  modelFree: true;
};

export type DuplicateCompany = {
  id: string;
  reason: string;
  records: { id: string; name: string; updatedAt: string | null }[];
};

type DuplicateCompanyInput = {
  id: string;
  name: string;
  domain?: string | null;
  website?: string | null;
  updated_at?: string | null;
};

type DuplicateContactInput = {
  company_id?: string | null;
  email?: string | null;
};

const nameKey = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/\b(limited|ltd|incorporated|inc|llc|plc|company|co)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();

const domainKey = (domain?: string | null, website?: string | null) =>
  String(domain || website || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();

// Conservative duplicate detector shared by the dashboard and the health
// report. It only reports exact normalised names/domains or the same contact
// email attached to different clients. It never changes CRM records.
export function findDuplicateCompanies(
  companies: DuplicateCompanyInput[],
  contacts: DuplicateContactInput[],
  limit = 20
): DuplicateCompany[] {
  const byId = new Map(companies.map((company) => [company.id, company]));
  const pairReasons = new Map<string, Set<string>>();
  const addPair = (a: string, b: string, reason: string) => {
    if (!a || !b || a === b) return;
    const key = [a, b].sort().join(":");
    const reasons = pairReasons.get(key) || new Set<string>();
    reasons.add(reason);
    pairReasons.set(key, reasons);
  };
  const group = (entries: { id: string; key: string }[], reason: string) => {
    const groups = new Map<string, string[]>();
    for (const entry of entries) {
      if (!entry.key) continue;
      const ids = groups.get(entry.key) || [];
      ids.push(entry.id);
      groups.set(entry.key, ids);
    }
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          addPair(ids[i], ids[j], reason);
        }
      }
    }
  };

  group(
    companies.map((company) => {
      const key = nameKey(company.name);
      return { id: company.id, key: key.length >= 4 ? key : "" };
    }),
    "same name"
  );
  group(
    companies.map((company) => ({
      id: company.id,
      key: domainKey(company.domain, company.website),
    })),
    "same website"
  );
  group(
    contacts.map((contact) => ({
      id: String(contact.company_id || ""),
      key: String(contact.email || "").toLowerCase().trim(),
    })),
    "same contact email"
  );

  return [...pairReasons.entries()]
    .map(([id, reasons]) => {
      const [aId, bId] = id.split(":");
      const a = byId.get(aId);
      const b = byId.get(bId);
      if (!a || !b) return null;
      return {
        id,
        reason: [...reasons].join(" + "),
        records: [a, b].map((company) => ({
          id: company.id,
          name: company.name,
          updatedAt: company.updated_at || null,
        })),
      };
    })
    .filter((row): row is DuplicateCompany => !!row)
    .slice(0, Math.max(0, limit));
}

type TaskInput = {
  id: string;
  company_id?: string | null;
  text?: string | null;
};

export type DuplicateTaskPair = {
  id: string;
  first: TaskInput;
  second: TaskInput;
};

// Bounded on purpose: a health refresh must stay cheap even after a large
// import. Tasks are only compared inside the same client scope and the first
// 120 per scope. Exact task creation is separately protected by fingerprints.
export function findNearDuplicateTasks(
  tasks: TaskInput[],
  limit = 40
): DuplicateTaskPair[] {
  const byScope = new Map<string, TaskInput[]>();
  for (const task of tasks) {
    if (!task.id || !String(task.text || "").trim()) continue;
    const scope = task.company_id || "global";
    const rows = byScope.get(scope) || [];
    if (rows.length < 120) rows.push(task);
    byScope.set(scope, rows);
  }

  const pairs: DuplicateTaskPair[] = [];
  for (const rows of byScope.values()) {
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        if (!isNearDuplicateTask(String(rows[i].text), String(rows[j].text))) {
          continue;
        }
        pairs.push({
          id: [rows[i].id, rows[j].id].sort().join(":"),
          first: rows[i],
          second: rows[j],
        });
        if (pairs.length >= limit) return pairs;
      }
    }
  }
  return pairs;
}

export function healthOverall(checks: HealthCheck[]): HealthStatus {
  if (checks.some((check) => check.status === "critical")) return "critical";
  if (checks.some((check) => check.status === "attention")) return "attention";
  return "healthy";
}

export function healthTotals(
  checks: HealthCheck[]
): Record<HealthStatus, number> {
  return checks.reduce<Record<HealthStatus, number>>(
    (totals, check) => {
      totals[check.status] += 1;
      return totals;
    },
    { healthy: 0, attention: 0, critical: 0 }
  );
}
