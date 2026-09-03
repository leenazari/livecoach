export type OutreachImportDecision = "ready" | "duplicate" | "review" | "invalid";

export type StagedOutreachImportRow = {
  rowNumber: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  companyName: string | null;
  companyDomain: string | null;
  website: string | null;
  industry: string | null;
  phone: string | null;
  personLinkedinUrl: string | null;
  companyLinkedinUrl: string | null;
  sourceStatus: string | null;
  importStatus:
    | "imported"
    | "contacted"
    | "replied"
    | "qualified"
    | "not_interested"
    | "suppressed";
  decision: OutreachImportDecision;
  reason: string;
};

const HEADER_ALIASES: Record<string, string[]> = {
  email: ["email", "email address", "email_address", "work email", "work_email"],
  firstName: ["first name", "first_name", "firstname", "given name"],
  lastName: ["last name", "last_name", "lastname", "surname", "family name"],
  fullName: ["name", "full name", "full_name", "contact name", "contact_name"],
  jobTitle: ["job title", "job_title", "title", "role", "position"],
  companyName: [
    "company",
    "company name",
    "company_name",
    "organisation",
    "organization",
    "account",
  ],
  companyDomain: ["company domain", "company_domain", "domain"],
  website: ["website", "company website", "company_website", "url"],
  industry: ["industry", "sector"],
  phone: ["phone", "phone number", "phone_number", "telephone", "mobile"],
  personLinkedinUrl: [
    "linkedin",
    "linkedin url",
    "linkedin_url",
    "person linkedin url",
    "person_linkedin_url",
  ],
  companyLinkedinUrl: [
    "company linkedin",
    "company linkedin url",
    "company_linkedin_url",
  ],
  sourceStatus: ["status", "lead status", "lead_status", "outcome", "result"],
};

const clean = (value: unknown, max = 500) => {
  const text = String(value ?? "").replace(/\u0000/g, "").trim();
  return text ? text.slice(0, max) : null;
};

const normalHeader = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");

function aliasedValue(row: Record<string, unknown>, field: keyof typeof HEADER_ALIASES) {
  const normalised = new Map(
    Object.entries(row).map(([key, value]) => [normalHeader(key), value])
  );
  for (const alias of HEADER_ALIASES[field]) {
    const value = normalised.get(normalHeader(alias));
    if (value != null && String(value).trim()) return value;
  }
  return null;
}

export function isValidImportEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value) && value.length <= 320;
}

function statusFromSource(value: string | null): StagedOutreachImportRow["importStatus"] {
  const status = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
  if (!status || /^(?:new|open|uncontacted|not contacted|to contact|untouched)$/.test(status)) {
    return "imported";
  }
  if (/do not contact|dnc|unsubscribe|opted out|blocked|suppressed/.test(status)) {
    return "suppressed";
  }
  if (/not interested|dead|closed lost|bad fit|no fit|rejected/.test(status)) {
    return "not_interested";
  }
  if (/qualified|meeting booked|demo booked|opportunity/.test(status)) return "qualified";
  if (/replied|responded|response received/.test(status)) return "replied";
  if (/contacted|called|emailed|messaged|reached/.test(status)) return "contacted";
  return "imported";
}

function splitName(fullName: string | null) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function normaliseOutreachImportRows(
  inputRows: unknown[],
  existingOutreachEmails: Set<string>,
  existingContactEmails: Set<string>
): StagedOutreachImportRow[] {
  const seen = new Set<string>();
  return inputRows.slice(0, 500).map((raw, index) => {
    const row = raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
    const email = String(aliasedValue(row, "email") || "").trim().toLowerCase();
    const suppliedFirst = clean(aliasedValue(row, "firstName"), 160);
    const suppliedLast = clean(aliasedValue(row, "lastName"), 160);
    const split = splitName(clean(aliasedValue(row, "fullName"), 320));
    const companyName = clean(aliasedValue(row, "companyName"), 240);
    const sourceStatus = clean(aliasedValue(row, "sourceStatus"), 160);
    let decision: OutreachImportDecision = "ready";
    let reason = "Ready to import";
    if (!email || !isValidImportEmail(email)) {
      decision = "invalid";
      reason = "A valid email address is required";
    } else if (!companyName) {
      decision = "review";
      reason = "Company is missing. Choose it manually before importing";
    } else if (seen.has(email)) {
      decision = "duplicate";
      reason = "Duplicate email in this file";
    } else if (existingOutreachEmails.has(email)) {
      decision = "duplicate";
      reason = "Already exists in Outreach";
    } else if (existingContactEmails.has(email)) {
      decision = "duplicate";
      reason = "Already exists as a CRM contact";
    }
    if (email) seen.add(email);
    return {
      rowNumber: index + 2,
      email,
      firstName: suppliedFirst || split.firstName,
      lastName: suppliedLast || split.lastName,
      jobTitle: clean(aliasedValue(row, "jobTitle"), 240),
      companyName,
      companyDomain: clean(aliasedValue(row, "companyDomain"), 240),
      website: clean(aliasedValue(row, "website"), 500),
      industry: clean(aliasedValue(row, "industry"), 240),
      phone: clean(aliasedValue(row, "phone"), 120),
      personLinkedinUrl: clean(aliasedValue(row, "personLinkedinUrl"), 500),
      companyLinkedinUrl: clean(aliasedValue(row, "companyLinkedinUrl"), 500),
      sourceStatus,
      importStatus: statusFromSource(sourceStatus),
      decision,
      reason,
    };
  });
}

export function parseCsvRows(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) return [];
  if (rows.length < 2) return [];
  const headers = rows[0].map((value, index) => value.trim() || `column_${index + 1}`);
  return rows.slice(1, 501).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))
  );
}
