export type OvernightOutreachQueueRow = {
  id?: string | null;
  status?: string | null;
  researched_at?: string | null;
  research?: unknown;
  prospect?: { id?: string | null } | null;
  sequenceStep?: { channel?: string | null } | null;
  message?: {
    id?: string | null;
    status?: string | null;
    subject?: string | null;
    body_text?: string | null;
    voice_script?: string | null;
  } | null;
};

export const OVERNIGHT_RESEARCH_INVENTORY_LIMIT = 20;

export const hasOvernightOutreachResearch = (
  row: OvernightOutreachQueueRow
) => {
  if (!row.researched_at) return false;
  return Boolean(
    row.research &&
      typeof row.research === "object" &&
      Object.keys(row.research as Record<string, unknown>).length
  );
};

export function needsOnlyOvernightVoiceScript(
  row: OvernightOutreachQueueRow
) {
  const message = row.message;
  return Boolean(
    message?.id &&
      ["draft", "failed"].includes(String(message.status || "")) &&
      !String(message.voice_script || "").trim()
  );
}

export function needsOvernightOutreachPreparation(
  row: OvernightOutreachQueueRow
) {
  if (!row.prospect?.id) return false;
  if ((row.sequenceStep?.channel || "email") !== "email") return false;
  if (!["queued", "researched", "drafted"].includes(String(row.status || "")))
    return false;

  const message = row.message;
  if (!message) return true;
  if (!["draft", "failed"].includes(String(message.status || ""))) return false;

  return Boolean(
    !String(message.subject || "").trim() ||
      !String(message.body_text || "").trim() ||
      !String(message.voice_script || "").trim() ||
      !hasOvernightOutreachResearch(row)
  );
}

export function needsNewOvernightOutreachResearch(
  row: OvernightOutreachQueueRow
) {
  return (
    needsOvernightOutreachPreparation(row) &&
    !hasOvernightOutreachResearch(row) &&
    !needsOnlyOvernightVoiceScript(row)
  );
}

export function selectOvernightOutreachPreparation(
  rows: OvernightOutreachQueueRow[],
  options: {
    outstandingResearch: number;
    maxAttempts: number;
    researchLimit?: number;
  }
) {
  const researchLimit = Math.max(
    0,
    Number(options.researchLimit ?? OVERNIGHT_RESEARCH_INVENTORY_LIMIT)
  );
  const outstandingResearch = Math.max(
    0,
    Number(options.outstandingResearch) || 0
  );
  const maxAttempts = Math.max(0, Number(options.maxAttempts) || 0);
  const eligible = rows.filter(needsOvernightOutreachPreparation);
  const recovery = eligible.filter(
    (row) => !needsNewOvernightOutreachResearch(row)
  );
  const newResearch = eligible.filter(needsNewOvernightOutreachResearch);
  const researchSlotsAvailable = Math.max(
    0,
    researchLimit - outstandingResearch
  );
  const admittedNewResearch = newResearch.slice(0, researchSlotsAvailable);
  const candidates = [...recovery, ...admittedNewResearch].slice(
    0,
    maxAttempts
  );

  return {
    candidates,
    eligible: eligible.length,
    outstandingResearch,
    researchLimit,
    researchSlotsAvailable,
    newResearchPlanned: candidates.filter(needsNewOvernightOutreachResearch)
      .length,
    deferredByResearchCap: Math.max(
      0,
      newResearch.length - researchSlotsAvailable
    ),
  };
}

export function roundRobinPreparationJobs<T>(
  groups: T[][],
  maximum: number
): T[] {
  const jobs: T[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < longest && jobs.length < maximum; index += 1) {
    for (const group of groups) {
      if (group[index] !== undefined) jobs.push(group[index]);
      if (jobs.length >= maximum) break;
    }
  }
  return jobs;
}
