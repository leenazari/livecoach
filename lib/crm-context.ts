import { supabaseAdmin } from "@/lib/supabase";

// Gathers EVERYTHING we know about one client into a single grounding string:
// profile, recent call scorecards (incl. focus scores), open opportunities,
// follow-up drafts, contacts, custom fields, and the company-scoped context
// store (notes / links / documents). Used by the client assistant, and (the
// context items) by the call planner's auto-attach.
export async function gatherClientContext(companyId: string): Promise<string> {
  const cut = (s: any, n: number) =>
    typeof s === "string" ? (s.length > n ? s.slice(0, n) + "…" : s) : "";

  const [{ data: company }, contactsRes, summariesRes, oppsRes, fuRes, ctxRes] =
    await Promise.all([
      supabaseAdmin
        .from("companies")
        .select("name, sector, stage, profile, attributes, notes, email_context")
        .eq("id", companyId)
        .single(),
      supabaseAdmin
        .from("contacts")
        .select("name, role, email")
        .eq("company_id", companyId)
        .limit(20),
      supabaseAdmin
        .from("interview_summaries")
        .select("candidate, created_at, summary")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(6),
      supabaseAdmin
        .from("opportunities")
        .select("title, detail, value, status")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("follow_ups")
        .select("draft_subject, status, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabaseAdmin
        .from("client_context")
        .select("kind, title, url, content, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

  // Upcoming calls for this client, synced from the calendar, so the assistant
  // can answer "when's our next call" / "what's coming up" from the CRM's copy.
  const { data: upcomingRows } = await supabaseAdmin
    .from("upcoming_calls")
    .select("title, scheduled_at, meeting_url, intent, prepped")
    .eq("company_id", companyId)
    .gte("scheduled_at", new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(10);

  if (!company) return "";

  // Pre-compute every field so we can render it as a value OR an explicit
  // "not set". Absent fields are what tempt the model to invent (e.g. a budget),
  // so we never leave one silently missing - we say it isn't recorded.
  const profile = (company.profile || {}) as any;
  const attrs = (company.attributes || {}) as any;
  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v !== null && v !== "" && v !== undefined)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join("; ");
  const contacts = contactsRes.data || [];
  const opps = (oppsRes.data || []).filter((o: any) => o.status === "open");
  const drafts = (fuRes.data || []).filter((f: any) => f.status === "draft");
  const summaries = summariesRes.data || [];
  const ctx = ctxRes.data || [];

  const hasNotes = !!(company.notes && String(company.notes).trim());
  const isThin =
    !hasNotes &&
    !profile.brief &&
    !attrStr &&
    contacts.length === 0 &&
    opps.length === 0 &&
    drafts.length === 0 &&
    summaries.length === 0 &&
    ctx.length === 0;

  const lines: string[] = [];

  if (isThin) {
    lines.push(
      `RECORD STATUS: this client's record is almost empty - only the name "${company.name}" has been entered. There is NO budget, deal value, stage, call history, contact, opportunity or next step on file. Do not infer or state any of these. Tell the user the record is thin and suggest what to capture first (link a call, set a stage, add a contact or a note).`,
      ""
    );
  }

  lines.push(`CLIENT: ${company.name}`);
  lines.push(`Sector: ${company.sector?.trim() || "not set"}`);
  lines.push(`Stage: ${company.stage?.trim() || "not set"}`);
  lines.push(`Notes: ${hasNotes ? String(company.notes).trim() : "none recorded"}`);
  const emailCtx = (company as any).email_context;
  if (emailCtx && String(emailCtx).trim()) {
    lines.push(
      "",
      "EMAIL CONTEXT (the email thread and relationship so far - this is where the relationship is actually happening right now, so weigh it heavily when judging the intent, the plan and the next steps):",
      String(emailCtx).trim(),
      ""
    );
  }
  const briefText = Array.isArray(profile.brief)
    ? profile.brief
        .filter((b: any) => typeof b === "string" && b.trim())
        .map((b: string) => `- ${b.trim()}`)
        .join("\n")
    : typeof profile.brief === "string"
    ? profile.brief
    : "";
  lines.push(
    `Background / what we know:${
      briefText ? `\n${briefText}` : " nothing recorded yet"
    }`
  );

  // BATTLE PLAN, if one has been built - so the suggested intent and the
  // assistant reason from the pre-call strategy (the objections, the fit, the
  // questions, the outcome), instead of it being a separate unused artifact.
  const bc = (profile as any).battlecard;
  if (bc && typeof bc === "object") {
    const arr = (v: any): string[] =>
      Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];
    const bl: string[] = [
      "",
      "BATTLE PLAN (the pre-call strategy already built for this client - weigh it when shaping the intent, focus and next steps):",
    ];
    if (bc.oneLiner) bl.push(`Read: ${bc.oneLiner}`);
    const strong = arr(bc.fit?.strong);
    const weak = arr(bc.fit?.weak);
    if (strong.length) bl.push(`Where we fit: ${strong.join("; ")}`);
    if (weak.length) bl.push(`Where we do not fit (do not oversell): ${weak.join("; ")}`);
    const objs = Array.isArray(bc.objections) ? bc.objections : [];
    if (objs.length) {
      bl.push("Objections to be ready for:");
      for (const o of objs.slice(0, 8)) {
        if (o && o.objection)
          bl.push(`- ${o.objection}${o.response ? ` -> ${o.response}` : ""}`);
      }
    }
    const qs = arr(bc.questionsToAsk);
    if (qs.length) bl.push(`Questions to ask: ${qs.slice(0, 6).join("; ")}`);
    if (bc.nextStep) bl.push(`Outcome to drive toward: ${bc.nextStep}`);
    lines.push(...bl);
  }
  lines.push(
    `Recorded fields (budget, value, owner, priority, etc.): ${
      attrStr || "none set - no budget or deal value has been entered for this client"
    }`
  );
  lines.push(
    `Contacts: ${
      contacts.length
        ? contacts
            .map((c: any) => `${c.name}${c.role ? ` (${c.role})` : ""}`)
            .join(", ")
        : "none recorded"
    }`
  );
  lines.push(
    `Open opportunities: ${
      opps.length
        ? opps
            .map(
              (o: any) =>
                `${o.title}${o.value ? ` (~£${o.value})` : ""}${o.detail ? ` - ${o.detail}` : ""}`
            )
            .join("; ")
        : "none recorded - no deal value or budget on file"
    }`
  );
  lines.push(
    `Follow-up drafts waiting: ${
      drafts.length
        ? drafts.map((f: any) => f.draft_subject || "(untitled)").join("; ")
        : "none"
    }`
  );

  const upcoming = upcomingRows || [];
  if (upcoming.length) {
    const nowMs = Date.now();
    lines.push("", "CALLS (from the synced calendar, UK time):");
    for (const u of upcoming as any[]) {
      const ms = u.scheduled_at ? new Date(u.scheduled_at).getTime() : null;
      const past = ms != null && ms < nowMs;
      const when = u.scheduled_at
        ? new Date(u.scheduled_at).toLocaleString("en-GB", {
            timeZone: "Europe/London",
            weekday: "short",
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "no time set";
      lines.push(
        `- ${when}${past ? " [ALREADY PASSED]" : ""}: ${u.title || "call"}${
          u.prepped ? " [prepped]" : ""
        }${u.intent ? ` - ${cut(u.intent, 160)}` : ""}${
          u.meeting_url ? ` (join link: ${u.meeting_url})` : ""
        }`
      );
    }
  } else {
    lines.push("Upcoming calls (synced calendar): none scheduled with this client");
  }

  if (summaries.length) {
    lines.push("", "PAST CALLS (most recent first):");
    for (const row of summaries as any[]) {
      const s = row.summary || {};
      const date = row.created_at
        ? new Date(row.created_at).toISOString().slice(0, 10)
        : "";
      const comps = Array.isArray(s.competencies)
        ? s.competencies
            .map((c: any) => `${c.name} ${c.score}/5`)
            .slice(0, 8)
            .join(", ")
        : "";
      const outstanding = [
        ...(Array.isArray(s.myNextActions) ? s.myNextActions : []),
        ...(Array.isArray(s.suggestedNextActions) ? s.suggestedNextActions : []),
      ]
        .slice(0, 4)
        .join("; ");
      let line = `- ${date}: ${cut(s.headline, 140)} ${cut(s.overview, 260)}`;
      if (comps) line += ` [focus scores: ${comps}]`;
      if (outstanding) line += ` [outstanding for us: ${cut(outstanding, 220)}]`;
      lines.push(line);
    }
  } else {
    lines.push("Past calls: none recorded");
  }

  if (ctx.length) {
    lines.push("", "EXTRA CONTEXT YOU ADDED (notes / links / documents):");
    for (const c of ctx as any[]) {
      const head = c.title || (c.kind === "link" ? c.url : c.kind);
      lines.push(`- [${c.kind}] ${head}: ${cut(c.content || c.url || "", 600)}`);
    }
  } else {
    lines.push("Extra context (notes / links / documents): none added");
  }

  return lines.join("\n");
}

// Everything across ALL clients, for the global assistant: each client with its
// profile, open opportunities, waiting drafts and outstanding tasks. Lets the
// assistant answer "show Alan's to-do" (it resolves the name) or "my to-do"
// (across everyone) without the user picking a client first.
export async function gatherGlobalContext(): Promise<string> {
  const cut = (s: any, n: number) =>
    typeof s === "string" ? (s.length > n ? s.slice(0, n) + "…" : s) : "";

  const [companiesRes, draftsRes, oppsRes, tasksRes, callsRes] =
    await Promise.all([
      supabaseAdmin
        .from("companies")
        .select("id, name, sector, stage, profile")
        .limit(500),
      supabaseAdmin
        .from("follow_ups")
        .select("company_id")
        .eq("status", "draft")
        .limit(500),
      supabaseAdmin
        .from("opportunities")
        .select("company_id, value")
        .eq("status", "open")
        .limit(500),
      supabaseAdmin
        .from("tasks")
        .select("company_id")
        .eq("status", "open")
        .limit(1000),
      supabaseAdmin
        .from("interview_summaries")
        .select("company_id, created_at")
        .not("company_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

  const companies = companiesRes.data || [];
  if (companies.length === 0) {
    return "The user has no clients in their CRM yet.";
  }

  // Compact per-client tallies. We keep this to ONE line per client so the
  // prompt stays small as the book of clients grows - the assistant pulls a
  // client's FULL detail separately (gatherClientContext) when the user names
  // one, so naming a client still gets depth (detail on demand).
  const draftCount = new Map<string, number>();
  for (const d of draftsRes.data || []) {
    if (!d.company_id) continue;
    draftCount.set(d.company_id, (draftCount.get(d.company_id) || 0) + 1);
  }
  const oppCount = new Map<string, number>();
  const oppValue = new Map<string, number>();
  for (const o of oppsRes.data || []) {
    if (!o.company_id) continue;
    oppCount.set(o.company_id, (oppCount.get(o.company_id) || 0) + 1);
    oppValue.set(
      o.company_id,
      (oppValue.get(o.company_id) || 0) + (Number(o.value) || 0)
    );
  }
  const taskCount = new Map<string, number>();
  for (const t of tasksRes.data || []) {
    if (!t.company_id) continue;
    taskCount.set(t.company_id, (taskCount.get(t.company_id) || 0) + 1);
  }
  // Most recent call per company (rows arrive newest-first, so first wins).
  const lastCall = new Map<string, string>();
  for (const s of callsRes.data || []) {
    if (!s.company_id || lastCall.has(s.company_id)) continue;
    lastCall.set(s.company_id, s.created_at as string);
  }
  const shortDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      });
    } catch {
      return "";
    }
  };

  const lines: string[] = [
    "YOUR CLIENTS AND PIPELINE - one compact line per client (name, stage, open opportunities and value, open to-dos, drafts, last contact, and a one-line note). Match a client the user names even if the spelling is slightly off. When the question is about a specific client, their FULL detail is given separately above. Answer pipeline-wide questions (which deal is closest, who has gone quiet, where the workload is) from these lines.",
    "",
  ];
  for (const c of companies as any[]) {
    const head = `• ${c.name}${
      c.stage || c.sector
        ? ` (${[c.stage, c.sector].filter(Boolean).join(", ")})`
        : ""
    }`;
    const bits: string[] = [];
    const oc = oppCount.get(c.id) || 0;
    const ov = oppValue.get(c.id) || 0;
    if (oc) bits.push(`${oc} open opp${oc > 1 ? "s" : ""}${ov ? ` ~£${ov}` : ""}`);
    const tc = taskCount.get(c.id) || 0;
    if (tc) bits.push(`${tc} open to-do${tc > 1 ? "s" : ""}`);
    const dc = draftCount.get(c.id) || 0;
    if (dc) bits.push(`${dc} draft${dc > 1 ? "s" : ""} waiting`);
    const lc = lastCall.get(c.id);
    bits.push(lc ? `last contact ${shortDate(lc)}` : "no calls logged");
    const rawBrief = (c.profile || {}).brief;
    const brief = Array.isArray(rawBrief)
      ? rawBrief.find((b: any) => typeof b === "string" && b.trim()) || ""
      : typeof rawBrief === "string"
      ? rawBrief
      : "";
    let line = `${head} - ${bits.join(", ")}`;
    if (brief) line += `. ${cut(brief, 110)}`;
    else if (!oc && !tc && !dc && !lc)
      line += ". no details recorded yet - thin record, do not infer any";
    lines.push(line);
  }

  // Upcoming calls across everyone, synced from the calendar, so "what's on my
  // calendar" / "what's next" works without picking a client first.
  const { data: upAll } = await supabaseAdmin
    .from("upcoming_calls")
    .select("company_id, title, scheduled_at, prepped, meeting_url")
    .gte("scheduled_at", new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(40);
  const up = upAll || [];
  if (up.length) {
    const nowMs = Date.now();
    const nameById = new Map<string, string>();
    for (const c of companies as any[]) nameById.set(c.id, c.name);
    lines.push(
      "",
      "YOUR CALLS (synced from your calendar, UK time, soonest first - items marked ALREADY PASSED are over, do not treat them as upcoming):"
    );
    for (const u of up as any[]) {
      const ms = u.scheduled_at ? new Date(u.scheduled_at).getTime() : null;
      const past = ms != null && ms < nowMs;
      const when = u.scheduled_at
        ? new Date(u.scheduled_at).toLocaleString("en-GB", {
            timeZone: "Europe/London",
            weekday: "short",
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "no time set";
      const who = u.company_id ? nameById.get(u.company_id) || "" : "";
      lines.push(
        `• ${when}${past ? " [ALREADY PASSED]" : ""}: ${u.title || "call"}${
          who ? ` (${who})` : ""
        }${u.prepped ? " [prepped]" : ""}${
          u.meeting_url ? ` - join link: ${u.meeting_url}` : " - no meeting link attached"
        }`
      );
    }
  }

  return lines.join("\n");
}

// Find the client(s) the user NAMED in their message, so the assistant can pull
// their FULL detail on demand instead of dumping every client's full record into
// every prompt. Matches the whole name, or a distinctive word from it (length
// >= 4, minus generic words), on word boundaries. Conservative cap of 3 so a
// vague question never drags in half the book.
const NAME_STOP = new Set([
  "university","college","of","the","and","referrals","city","group","ltd",
  "school","global","limited","inc",
]);
export async function findCompaniesNamedIn(
  message: string
): Promise<{ id: string; name: string }[]> {
  const norm = (s: string) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const m = ` ${norm(message)} `;
  if (m.trim().length < 2) return [];
  const { data } = await supabaseAdmin
    .from("companies")
    .select("id, name, profile")
    .limit(500);
  const out: { id: string; name: string }[] = [];
  for (const c of (data || []) as any[]) {
    const full = norm(c.name);
    let matched = full.length >= 4 && m.includes(` ${full} `);
    if (!matched) {
      const toks = full
        .split(" ")
        .filter((t) => t.length >= 4 && !NAME_STOP.has(t));
      for (const t of toks) {
        if (m.includes(` ${t} `)) {
          matched = true;
          break;
        }
      }
    }
    // Learned aliases (e.g. "elaine" -> Alain). A saved mispronunciation resolves
    // to the right client with no prompt.
    if (!matched) {
      const aliases = Array.isArray((c.profile || {}).aliases)
        ? (c.profile as any).aliases
        : [];
      for (const a of aliases) {
        const na = norm(String(a || ""));
        if (na.length >= 2 && m.includes(` ${na} `)) {
          matched = true;
          break;
        }
      }
    }
    if (matched) out.push({ id: c.id, name: c.name });
    if (out.length >= 3) break;
  }
  return out;
}
