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
        .select("name, sector, stage, profile, attributes, notes")
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

  if (!company) return "";

  const lines: string[] = [];
  lines.push(
    `CLIENT: ${company.name}${company.sector ? ` | sector: ${company.sector}` : ""}${
      company.stage ? ` | stage: ${company.stage}` : ""
    }`
  );
  if (company.notes && String(company.notes).trim())
    lines.push(`Notes: ${String(company.notes).trim()}`);

  const profile = (company.profile || {}) as any;
  if (profile.brief) lines.push(`What we know: ${profile.brief}`);

  const attrs = (company.attributes || {}) as any;
  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v !== null && v !== "" && v !== undefined)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join("; ");
  if (attrStr) lines.push(`Fields: ${attrStr}`);

  const contacts = contactsRes.data || [];
  if (contacts.length)
    lines.push(
      `Contacts: ${contacts
        .map((c: any) => `${c.name}${c.role ? ` (${c.role})` : ""}`)
        .join(", ")}`
    );

  const opps = (oppsRes.data || []).filter((o: any) => o.status === "open");
  if (opps.length)
    lines.push(
      `Open opportunities: ${opps
        .map(
          (o: any) =>
            `${o.title}${o.value ? ` (~£${o.value})` : ""}${o.detail ? ` - ${o.detail}` : ""}`
        )
        .join("; ")}`
    );

  const drafts = (fuRes.data || []).filter((f: any) => f.status === "draft");
  if (drafts.length)
    lines.push(
      `Follow-up drafts waiting: ${drafts
        .map((f: any) => f.draft_subject || "(untitled)")
        .join("; ")}`
    );

  const summaries = summariesRes.data || [];
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
  }

  const ctx = ctxRes.data || [];
  if (ctx.length) {
    lines.push("", "EXTRA CONTEXT YOU ADDED (notes / links / documents):");
    for (const c of ctx as any[]) {
      const head = c.title || (c.kind === "link" ? c.url : c.kind);
      lines.push(`- [${c.kind}] ${head}: ${cut(c.content || c.url || "", 600)}`);
    }
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

  const [companiesRes, draftsRes, oppsRes, summariesRes] = await Promise.all([
    supabaseAdmin
      .from("companies")
      .select("id, name, sector, stage, profile")
      .limit(200),
    supabaseAdmin
      .from("follow_ups")
      .select("company_id, draft_subject")
      .eq("status", "draft")
      .limit(200),
    supabaseAdmin
      .from("opportunities")
      .select("company_id, title, value")
      .eq("status", "open")
      .limit(200),
    supabaseAdmin
      .from("interview_summaries")
      .select("company_id, summary, created_at")
      .not("company_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  const companies = companiesRes.data || [];
  if (companies.length === 0) {
    return "The user has no clients in their CRM yet.";
  }

  const draftsBy = new Map<string, string[]>();
  for (const d of draftsRes.data || []) {
    if (!d.company_id) continue;
    const arr = draftsBy.get(d.company_id) || [];
    arr.push(d.draft_subject || "(untitled)");
    draftsBy.set(d.company_id, arr);
  }
  const oppsBy = new Map<string, string[]>();
  for (const o of oppsRes.data || []) {
    if (!o.company_id) continue;
    const arr = oppsBy.get(o.company_id) || [];
    arr.push(`${o.title}${o.value ? ` (~£${o.value})` : ""}`);
    oppsBy.set(o.company_id, arr);
  }
  // Latest call's tasks per company.
  const tasksBy = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const s of summariesRes.data || []) {
    if (!s.company_id || seen.has(s.company_id)) continue;
    seen.add(s.company_id);
    const my = Array.isArray((s.summary as any)?.myNextActions)
      ? (s.summary as any).myNextActions
      : [];
    if (my.length) tasksBy.set(s.company_id, my.slice(0, 4));
  }

  const lines: string[] = [
    "YOUR CLIENTS AND YOUR WHOLE PIPELINE. The user may refer to a client by a slightly different name or spelling - match it to the closest client below.",
    "",
  ];
  for (const c of companies as any[]) {
    const bits: string[] = [
      `• ${c.name}${c.sector ? ` (${c.sector}${c.stage ? `, ${c.stage}` : ""})` : ""}`,
    ];
    const brief = (c.profile || {}).brief;
    if (brief) bits.push(`    what we know: ${cut(brief, 220)}`);
    const t = tasksBy.get(c.id);
    if (t && t.length) bits.push(`    your outstanding tasks: ${t.join("; ")}`);
    const dr = draftsBy.get(c.id);
    if (dr && dr.length) bits.push(`    drafts waiting to send: ${dr.join("; ")}`);
    const op = oppsBy.get(c.id);
    if (op && op.length) bits.push(`    open opportunities: ${op.join("; ")}`);
    lines.push(bits.join("\n"));
  }
  return lines.join("\n");
}
