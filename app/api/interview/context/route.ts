import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extractTextFromPDF } from "@/lib/pdf-extract";
import { getWorkstreamScope } from "@/lib/workstreams";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "knowledge_docs";

async function listFiles(prefix: string) {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .list(prefix, {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });
  if (error || !data) return [];
  return data;
}

// PHASE 2 - auto-attach client history. When a call is linked to a company,
// pull that company's profile, notes, custom fields, contacts and recent call
// scorecards into a compact context block, so the plan starts the call already
// knowing the relationship instead of from a blank slate.
async function companyHistoryBlock(
  companyId: string,
  workstreamId?: string | null
): Promise<{ block: string; source: string } | null> {
  try {
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name, sector, stage, profile, attributes, notes, email_context")
      .eq("id", companyId)
      .single();
    if (!company) return null;
    const workstream = workstreamId
      ? await getWorkstreamScope(workstreamId)
      : null;
    if (workstreamId && (!workstream || workstream.companyId !== companyId))
      return null;
    let contactIds: string[] = [];
    if (workstream) {
      const { data: links } = await supabaseAdmin
        .from("workstream_contacts")
        .select("contact_id")
        .eq("workstream_id", workstream.id);
      contactIds = (links || []).map((link: any) => link.contact_id);
    }

    let contactsQuery = supabaseAdmin
      .from("contacts")
      .select("name, role")
      .eq("company_id", companyId)
      .limit(20);
    let summariesQuery = supabaseAdmin
      .from("interview_summaries")
      .select("candidate, created_at, summary")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(5);
    let contextQuery = supabaseAdmin
      .from("client_context")
      .select("kind, title, url, content")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(15);
    if (workstream) {
      contactsQuery = contactIds.length
        ? contactsQuery.in("id", contactIds)
        : contactsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
      summariesQuery = summariesQuery.eq("workstream_id", workstream.id);
      contextQuery = contextQuery.eq("workstream_id", workstream.id);
    }

    const [{ data: contacts }, { data: summaries }, { data: ctxItems }, { data: thread }] =
      await Promise.all([
        contactsQuery,
        summariesQuery,
        contextQuery,
        workstream
          ? supabaseAdmin
              .from("workstreams")
              .select("email_context")
              .eq("id", workstream.id)
              .single()
          : Promise.resolve({ data: null, error: null }),
      ]);

    const lines: string[] = [];
    lines.push(
      `### CLIENT / RELATIONSHIP HISTORY - ${company.name}${workstream ? ` / ${workstream.name}` : ""}`,
      `This call is with an EXISTING client. Use this history - do not start from scratch, and build on what's already happened.`,
      `Company: ${company.name}${company.sector ? ` | sector: ${company.sector}` : ""}${
        company.stage ? ` | stage: ${company.stage}` : ""
      }`
    );
    if (workstream) {
      lines.push(
        `Department: ${workstream.departmentName || "not set"}`,
        `Workstream: ${workstream.name}`,
        `Purpose: ${workstream.purpose || "not set"}`,
        "Use only this workstream's calls, contacts, actions and email context. Other departments at this company are separate."
      );
    }

    if (!workstream && company.notes && String(company.notes).trim()) {
      lines.push(`Notes: ${String(company.notes).trim()}`);
    }

    const emailCtx = workstream
      ? (thread as any)?.email_context
      : (company as any).email_context;
    if (emailCtx && String(emailCtx).trim()) {
      lines.push(
        "EMAIL CONTEXT (the email thread so far - where the relationship is actually happening; weigh it heavily for the intent, plan and next steps):",
        String(emailCtx).trim()
      );
    }

    const profile = (company.profile || {}) as any;
    if (!workstream && profile && typeof profile === "object" && Object.keys(profile).length) {
      // Render the battlecard and the cached research as their own clean
      // sections below - keep them out of the raw dump so they are not giant
      // unusable JSON blobs in the middle of things.
      const p = Object.entries(profile)
        .filter(([k]) => k !== "battlecard" && k !== "research")
        .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("; ");
      if (p) lines.push(`What we know: ${p}`);
    }

    // CACHED COMPANY RESEARCH -> the open-web briefing the prep chain bought for
    // this client. It is bought once per company and reused, so every plan and
    // every live call reads the same grounded picture of who they are.
    const research = (profile as any).research;
    if (
      research &&
      typeof research === "object" &&
      typeof research.background === "string" &&
      research.background.trim()
    ) {
      const when =
        typeof research.generatedAt === "string"
          ? research.generatedAt.slice(0, 10)
          : "";
      lines.push(
        "",
        `RESEARCHED BACKGROUND on this organisation${
          when ? ` (as at ${when})` : ""
        } - grounded in the open web, use it, do not contradict it:`,
        research.background.trim()
      );
    }

    // BATTLE PLAN -> feed the intent, the focus areas and the plan. This is the
    // pre-call strategy the user built, so the plan must be shaped by it, not
    // ignore it: the objections to be ready for, where we fit and do not, the
    // questions to ask, and the outcome to drive toward.
    const bc = workstream ? null : profile.battlecard;
    if (bc && typeof bc === "object") {
      const list = (v: any): string[] =>
        Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];
      lines.push(
        "",
        "BATTLE PLAN FOR THIS CALL (the user's pre-call strategy - let it drive the intent, the focus areas and the plan, do not start from scratch):"
      );
      if (bc.oneLiner) lines.push(`Read: ${bc.oneLiner}`);
      const strong = list(bc.fit?.strong);
      const weak = list(bc.fit?.weak);
      if (strong.length) lines.push(`Where we fit, lean in: ${strong.join("; ")}`);
      if (weak.length)
        lines.push(`Where we do NOT fit, do not oversell: ${weak.join("; ")}`);
      const objs = Array.isArray(bc.objections) ? bc.objections : [];
      if (objs.length) {
        lines.push("Objections to be ready for, and the line to take:");
        for (const o of objs.slice(0, 8)) {
          if (o && o.objection)
            lines.push(`- ${o.objection}${o.response ? ` -> ${o.response}` : ""}`);
        }
      }
      const qs = list(bc.questionsToAsk);
      if (qs.length) lines.push(`Questions to ask them: ${qs.slice(0, 6).join("; ")}`);
      if (bc.nextStep) lines.push(`Outcome to drive toward: ${bc.nextStep}`);
    }

    const attrs = company.attributes || {};
    if (attrs && typeof attrs === "object" && Object.keys(attrs).length) {
      const a = Object.entries(attrs)
        .filter(([, v]) => v !== null && v !== "" && v !== undefined)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
        .join("; ");
      if (a) lines.push(`Fields: ${a}`);
    }

    if (Array.isArray(contacts) && contacts.length) {
      lines.push(
        `Contacts: ${contacts
          .map((c: any) => `${c.name}${c.role ? ` (${c.role})` : ""}`)
          .join(", ")}`
      );
    }

    if (Array.isArray(summaries) && summaries.length) {
      lines.push("", "Past calls (most recent first):");
      const cut = (s: any, n: number) =>
        typeof s === "string" ? (s.length > n ? s.slice(0, n) + "…" : s) : "";
      for (const row of summaries) {
        const s = (row as any).summary || {};
        const date = (row as any).created_at
          ? new Date((row as any).created_at).toISOString().slice(0, 10)
          : "";
        const who = (row as any).candidate ? ` with ${(row as any).candidate}` : "";
        const parts: string[] = [];
        if (s.headline) parts.push(cut(s.headline, 160));
        if (s.overview) parts.push(cut(s.overview, 320));
        const outstanding = [
          ...(Array.isArray(s.myNextActions) ? s.myNextActions : []),
          ...(Array.isArray(s.suggestedNextActions) ? s.suggestedNextActions : []),
        ]
          .slice(0, 4)
          .join("; ");
        const theirs = (Array.isArray(s.theirNextActions) ? s.theirNextActions : [])
          .slice(0, 4)
          .join("; ");
        let line = `- ${date}${who}: ${parts.join(" ")}`;
        if (outstanding) line += ` [outstanding for us: ${cut(outstanding, 240)}]`;
        if (theirs) line += ` [they said they'd: ${cut(theirs, 240)}]`;
        lines.push(line);
      }
    } else {
      lines.push(
        "",
        workstream
          ? "No past calls recorded in this workstream yet."
          : "No past calls recorded with this client yet."
      );
    }

    // Extra context the user attached to the client (notes / links / docs).
    if (Array.isArray(ctxItems) && ctxItems.length) {
      const cut2 = (s: any, n: number) =>
        typeof s === "string" ? (s.length > n ? s.slice(0, n) + "…" : s) : "";
      lines.push("", "EXTRA CONTEXT the caller attached to this client:");
      for (const c of ctxItems as any[]) {
        const head = c.title || (c.kind === "link" ? c.url : c.kind);
        lines.push(`- [${c.kind}] ${head}: ${cut2(c.content || c.url || "", 500)}`);
      }
    }

    return {
      block: lines.join("\n") + "\n\n",
      source: `${company.name}${workstream ? `, ${workstream.name}` : ""} history (CRM)`,
    };
  } catch (e) {
    console.error("Company history load failed:", e);
    return null;
  }
}

async function downloadText(path: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .download(path);
  if (error || !data) return "";
  if (path.toLowerCase().endsWith(".pdf")) {
    try {
      const buf = new Uint8Array(await data.arrayBuffer());
      return await extractTextFromPDF(buf);
    } catch (e) {
      console.error("PDF extract failed:", path, e);
      return "";
    }
  }
  return await data.text();
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId, companyId, workstreamId } = await req.json();

    let context = "";
    const sources: string[] = [];

    // 1. Frameworks - always (reusable, global).
    const frameworks = await listFiles("framework/global");
    for (const f of frameworks) {
      if (!f.name || f.id === null) continue;
      const t = await downloadText(`framework/global/${f.name}`);
      if (t.trim()) {
        context += `### QUESTION FRAMEWORK (${f.name})\n${t}\n\n`;
        sources.push(`${f.name} (framework)`);
      }
    }

    // 2. CV + summary - ONLY for this session. No global fallback, so an
    //    empty session loads no candidate context and cues stay generic.
    if (sessionId) {
      const cvs = await listFiles(`session/${sessionId}/cv`);
      for (const f of cvs) {
        if (!f.name || f.id === null) continue;
        const t = await downloadText(`session/${sessionId}/cv/${f.name}`);
        if (t.trim()) {
          context += `### UPLOADED DOCUMENT (${f.name}) - subject matter for this call\n${t}\n\n`;
          sources.push(`${f.name} (cv)`);
        }
      }

      const summaries = await listFiles(`session/${sessionId}/summary`);
      for (const f of summaries) {
        if (!f.name || f.id === null) continue;
        const t = await downloadText(`session/${sessionId}/summary/${f.name}`);
        if (t.trim()) {
          context += `### PREVIOUS SUMMARY (${f.name})\n${t}\n\n`;
          sources.push(`${f.name} (summary)`);
        }
      }
    }

    // PHASE 2: prepend the linked client's history so it survives the plan
    // route's head-truncation and the planner reads it first.
    if (typeof companyId === "string" && companyId) {
      const hist = await companyHistoryBlock(
        companyId,
        typeof workstreamId === "string" ? workstreamId : null
      );
      if (hist) {
        context = hist.block + context;
        sources.unshift(hist.source);
      }
    }

    return NextResponse.json({
      context,
      sources,
      chunkCount: sources.length,
    });
  } catch (err: any) {
    console.error("Context load error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load context" },
      { status: 500 }
    );
  }
}
