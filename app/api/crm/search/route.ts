import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchResult = {
  id: string;
  type: "client" | "contact" | "call" | "task" | "opportunity" | "draft" | "playbook";
  label: string;
  detail: string;
  href: string;
};

const compact = (value: any, max = 150) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;
};

export async function GET(req: NextRequest) {
  try {
    const raw = (req.nextUrl.searchParams.get("q") || "").trim();
    if (raw.length < 2) return NextResponse.json({ results: [] });
    // Prevent PostgREST filter punctuation from changing the query structure.
    const q = raw.replace(/[,()*%]/g, " ").replace(/\s+/g, " ").trim();
    if (q.length < 2) return NextResponse.json({ results: [] });

    const [companiesRes, contactsRes, callsRes, tasksRes, oppsRes, draftsRes, playbooksRes] =
      await Promise.all([
        supabaseAdmin
          .from("companies")
          .select("id, name, sector, stage, notes, email_context")
          .or(`name.ilike.%${q}%,sector.ilike.%${q}%,notes.ilike.%${q}%,email_context.ilike.%${q}%`)
          .limit(8),
        supabaseAdmin
          .from("contacts")
          .select("id, company_id, name, role, email, notes")
          .or(`name.ilike.%${q}%,role.ilike.%${q}%,email.ilike.%${q}%,notes.ilike.%${q}%`)
          .limit(8),
        supabaseAdmin
          .from("interview_summaries")
          .select("id, company_id, candidate, role, summary, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
        supabaseAdmin
          .from("tasks")
          .select("id, company_id, text, kind")
          .eq("status", "open")
          .ilike("text", `%${q}%`)
          .limit(8),
        supabaseAdmin
          .from("opportunities")
          .select("id, company_id, title, detail, value")
          .eq("status", "open")
          .or(`title.ilike.%${q}%,detail.ilike.%${q}%`)
          .limit(8),
        supabaseAdmin
          .from("follow_ups")
          .select("id, company_id, draft_subject, draft_body")
          .eq("status", "draft")
          .or(`draft_subject.ilike.%${q}%,draft_body.ilike.%${q}%`)
          .limit(8),
        supabaseAdmin
          .from("lessons")
          .select("id, title, content, created_at")
          .eq("topic", "pitching")
          .or(`title.ilike.%${q}%,content.ilike.%${q}%`)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

    for (const response of [companiesRes, contactsRes, callsRes, tasksRes, oppsRes, draftsRes, playbooksRes])
      if (response.error) throw response.error;

    // Summary is JSONB, so PostgREST cannot apply ilike directly. Search the
    // bounded recent-call set in memory and keep only the first eight matches.
    const callRows = (callsRes.data || [])
      .filter((c: any) =>
        [c.candidate, c.role, JSON.stringify(c.summary || "")]
          .join(" ")
          .toLowerCase()
          .includes(q.toLowerCase())
      )
      .slice(0, 8);

    const companyIds = new Set<string>();
    for (const rows of [contactsRes.data, callRows, tasksRes.data, oppsRes.data, draftsRes.data])
      for (const row of rows || []) if ((row as any).company_id) companyIds.add((row as any).company_id);
    const { data: linkedCompanies, error: linkedError } = companyIds.size
      ? await supabaseAdmin.from("companies").select("id, name").in("id", [...companyIds])
      : { data: [], error: null };
    if (linkedError) throw linkedError;
    const companyName = new Map((linkedCompanies || []).map((c: any) => [c.id, c.name]));

    const results: SearchResult[] = [];
    for (const c of companiesRes.data || [])
      results.push({
        id: `client:${c.id}`,
        type: "client",
        label: c.name,
        detail: compact([c.stage, c.sector, c.notes || c.email_context].filter(Boolean).join(" · ")),
        href: `/crm/${c.id}`,
      });
    for (const c of contactsRes.data || [])
      results.push({
        id: `contact:${c.id}`,
        type: "contact",
        label: c.name,
        detail: compact([c.role, c.email, companyName.get(c.company_id), c.notes].filter(Boolean).join(" · ")),
        href: c.company_id ? `/crm/${c.company_id}` : "/crm/board?tab=clients",
      });
    for (const c of callRows)
      results.push({
        id: `call:${c.id}`,
        type: "call",
        label: c.candidate || companyName.get(c.company_id) || "Call",
        detail: compact(
          [
            c.role,
            typeof c.summary === "string"
              ? c.summary
              : JSON.stringify(c.summary || ""),
          ]
            .filter(Boolean)
            .join(" · ")
        ),
        href: `/crm/calls/${c.id}`,
      });
    for (const t of tasksRes.data || [])
      results.push({
        id: `task:${t.id}`,
        type: "task",
        label: t.text,
        detail: compact([companyName.get(t.company_id), t.kind].filter(Boolean).join(" · ")),
        href: t.company_id ? `/crm/${t.company_id}` : "/crm/board?tab=tasks",
      });
    for (const o of oppsRes.data || [])
      results.push({
        id: `opportunity:${o.id}`,
        type: "opportunity",
        label: o.title,
        detail: compact([companyName.get(o.company_id), o.detail, o.value ? `£${Number(o.value).toLocaleString()}` : ""].filter(Boolean).join(" · ")),
        href: o.company_id ? `/crm/${o.company_id}` : "/crm/board?tab=opportunities",
      });
    for (const d of draftsRes.data || [])
      results.push({
        id: `draft:${d.id}`,
        type: "draft",
        label: d.draft_subject || "Draft email",
        detail: compact([companyName.get(d.company_id), d.draft_body].filter(Boolean).join(" · ")),
        href: "/crm/board?tab=drafts",
      });
    for (const lesson of playbooksRes.data || []) {
      let content: any = {};
      try {
        content = JSON.parse(String(lesson.content || "{}"));
      } catch {
        content = {};
      }
      results.push({
        id: `playbook:${lesson.id}`,
        type: "playbook",
        label: lesson.title || "Pitching lesson",
        detail: compact([content.scenario, content.audience].filter(Boolean).join(" · ")),
        href: `/crm/pitch-playbook?lesson=${lesson.id}`,
      });
    }

    const needle = q.toLowerCase();
    results.sort((a, b) => {
      const ar = a.label.toLowerCase() === needle ? 0 : a.label.toLowerCase().startsWith(needle) ? 1 : 2;
      const br = b.label.toLowerCase() === needle ? 0 : b.label.toLowerCase().startsWith(needle) ? 1 : 2;
      return ar - br;
    });
    return NextResponse.json({ results: results.slice(0, 24) });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "CRM search failed" },
      { status: 500 }
    );
  }
}
