// Decide whether an open to-do has PASSED and should drop off the list. Kept
// deliberately conservative and deterministic (no model): it only clears tasks
// that are demonstrably about a moment that is gone, never a task that is merely
// overdue or that someone might still want. Four signals:
//   A. a "prep for the call" task whose call has already happened,
//   B. a "tomorrow / today" task whose day has passed,
//   C. a prep/event task naming an explicit date that has passed (recent only),
//   D. an untouched loose task that is at least 60 days old and has no explicit
//      priority protection.

const DAY_MS = 24 * 60 * 60 * 1000;
export const TASK_RETENTION_DAYS = 60;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const norm = (s: string) =>
  (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

// YYYY-MM-DD for a date, in London time (string-comparable).
export function londonYMD(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function isPrepText(txt: string): boolean {
  const t = txt.toLowerCase();
  const prep = /\b(prepare|prep|get ready|brief yourself|brief up)\b/.test(t);
  const evt = /\b(call|meeting|demo|interview|pitch)\b/.test(t);
  return (
    (prep && evt) ||
    /\b(ahead of|before) the (call|meeting|demo)\b/.test(t) ||
    /\bprep call\b/.test(t)
  );
}

function parsePastDate(txt: string, todayYMD: string): string | null {
  const t = txt.toLowerCase();
  const year = Number(todayYMD.slice(0, 4));
  let mo = 0;
  let day = 0;
  let m = t.match(
    /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/
  );
  if (m) {
    day = Number(m[1]);
    mo = MONTHS[m[2]];
  } else {
    m = t.match(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/
    );
    if (m) {
      mo = MONTHS[m[1]];
      day = Number(m[2]);
    }
  }
  if (!mo || !day || day > 31) return null;
  return `${year}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type StaleTask = {
  company_id: string | null;
  workstream_id?: string | null;
  text: string;
  kind?: string | null;
  link_kind?: string | null;
  created_at: string;
  due_at?: string | null;
  payload?: Record<string, unknown> | null;
};

export type StaleCtx = {
  // Each client and its matchable names (the name plus any aliases), normalised.
  companies: { id: string; names: string[] }[];
  // Latest recorded-call time (ms) per client, for the "call already happened" rule.
  lastCallMsByCompany: Map<string, number>;
  todayYMD: string;
  // Canonical active CRM records. These are loaded once from stored data, not
  // inferred by a model or rebuilt from historic transcripts.
  activePriorityCompanyIds?: Set<string>;
  activeWorkstreamIds?: Set<string>;
  nowMs?: number;
};

function priorityProtectsRetention(task: StaleTask, ctx: StaleCtx): boolean {
  const payload =
    task.payload && typeof task.payload === "object" ? task.payload : {};
  if (payload.pinned === true || payload.retentionProtected === true) return true;

  const urgency = String(payload.urgency || "").toLowerCase();
  if (urgency === "high" || urgency === "urgent") return true;

  // A deadline is an explicit human/system commitment. Even when overdue, it
  // must stay visible until someone completes, dismisses or reschedules it.
  if (task.due_at && Number.isFinite(new Date(task.due_at).getTime())) return true;

  if (
    task.company_id &&
    ctx.activePriorityCompanyIds?.has(task.company_id)
  ) {
    return true;
  }
  if (task.workstream_id && ctx.activeWorkstreamIds?.has(task.workstream_id)) {
    return true;
  }
  return false;
}

export function isStaleTask(
  task: StaleTask,
  ctx: StaleCtx
): { stale: boolean; reason: string } {
  const txt = String(task.text || "");
  const createdMs = new Date(task.created_at).getTime();
  const prep = isPrepText(txt);

  // A. A prep task whose call has already happened.
  if (prep) {
    const targets: string[] = [];
    if (task.company_id) targets.push(task.company_id);
    const ntxt = ` ${norm(txt)} `;
    for (const c of ctx.companies) {
      if (c.names.some((n) => n.length >= 4 && ntxt.includes(` ${n} `))) {
        targets.push(c.id);
      }
    }
    for (const cid of targets) {
      const last = ctx.lastCallMsByCompany.get(cid);
      if (typeof last === "number" && last > createdMs) {
        return { stale: true, reason: "the call this preps for has happened" };
      }
    }
  }

  // B. A "tomorrow / today" reference whose day has passed.
  const rel = txt
    .toLowerCase()
    .match(/\b(tomorrow|today|tonight|this (?:morning|afternoon|evening))\b/);
  if (rel) {
    const base = new Date(task.created_at);
    if (rel[1] === "tomorrow") base.setUTCDate(base.getUTCDate() + 1);
    if (londonYMD(base) < ctx.todayYMD) {
      return { stale: true, reason: `"${rel[1]}" has passed` };
    }
  }

  // C. An explicit date that has passed (prep/event tasks, recent past only, so
  // an ambiguous far-off or next-year date is never wrongly cleared).
  if (prep || /\b(call|meeting|demo|event|filming|show|deadline)\b/i.test(txt)) {
    const d = parsePastDate(txt, ctx.todayYMD);
    if (d && d < ctx.todayYMD) {
      const dMs = new Date(`${d}T00:00:00Z`).getTime();
      const todayMs = new Date(`${ctx.todayYMD}T00:00:00Z`).getTime();
      if (todayMs - dMs <= 120 * 24 * 60 * 60 * 1000) {
        return { stale: true, reason: `the date (${d}) has passed` };
      }
    }
  }

  // D. Keep the active list lean without destroying history. A task is only
  // auto-dismissed after 60 untouched days when it carries no explicit priority
  // signal. A recent edit resets the clock through payload.retentionTouchedAt.
  const nowMs = Number.isFinite(ctx.nowMs) ? Number(ctx.nowMs) : Date.now();
  const touchedMs = new Date(
    typeof task.payload?.retentionTouchedAt === "string"
      ? task.payload.retentionTouchedAt
      : task.created_at
  ).getTime();
  const lastTouchedMs = Number.isFinite(touchedMs) ? touchedMs : createdMs;
  if (
    Number.isFinite(lastTouchedMs) &&
    nowMs - lastTouchedMs >= TASK_RETENTION_DAYS * DAY_MS &&
    !priorityProtectsRetention(task, ctx)
  ) {
    return {
      stale: true,
      reason: `${TASK_RETENTION_DAYS} days old with no active priority`,
    };
  }

  return { stale: false, reason: "" };
}
