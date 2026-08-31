export type OvernightOutreachQueueRow = {
  id?: string | null;
  status?: string | null;
  researched_at?: string | null;
  research?: unknown;
  prospect?: { id?: string | null } | null;
  sequenceStep?: { channel?: string | null } | null;
  message?: {
    status?: string | null;
    subject?: string | null;
    body_text?: string | null;
    voice_script?: string | null;
  } | null;
};

const hasResearch = (row: OvernightOutreachQueueRow) => {
  if (!row.researched_at) return false;
  return Boolean(
    row.research &&
      typeof row.research === "object" &&
      Object.keys(row.research as Record<string, unknown>).length
  );
};

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
      !hasResearch(row)
  );
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
