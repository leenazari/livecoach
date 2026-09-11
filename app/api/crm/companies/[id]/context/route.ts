import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

import { requireRequestScope } from "@/lib/request-scope";
import { loadAssignedClientAccess } from "@/lib/assigned-client-access";
import { loadTeamLeadNotes } from "@/lib/team-lead-cover";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";

// Per-client context store: notes, links, and extracted document text that
// augment a client beyond its calls. Feeds the assistant and the next call's
// auto-attached plan.
//
// GET  /api/crm/companies/:id/context -> list
// POST /api/crm/companies/:id/context -> add { kind, title?, url?, content? }
//      kind: 'note' | 'link' | 'doc'. For 'link', the server fetches the page
//      text best-effort so it actually feeds context.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    const { data, error } = await supabaseAdmin
      .from("client_context")
      .select("*")
      .eq("company_id", params.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    const teamNotes = await loadTeamLeadNotes(params.id, scope);
    const items = [...new Map([...(data || []), ...teamNotes].map((row) => [row.id, row])).values()].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
    return NextResponse.json({ items });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load context" },
      { status: 500 }
    );
  }
}

async function fetchLinkText(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (LiveCoach context fetch)" },
    });
    clearTimeout(timer);
    if (!res.ok) return "";
    const html = await res.text();
    // Crude text extraction: strip scripts/styles/tags, collapse whitespace.
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 6000);
  } catch {
    return "";
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    if (!(await loadAssignedClientAccess(params.id, scope))) return NextResponse.json({ error: "Client unavailable" }, { status: 404 });
    const body = await req.json();
    const kind = ["note", "link", "doc"].includes(body.kind) ? body.kind : "note";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const url = typeof body.url === "string" ? body.url.trim() : "";
    let content = typeof body.content === "string" ? body.content.trim() : "";

    if (kind === "link") {
      if (!url) {
        return NextResponse.json({ error: "url is required" }, { status: 400 });
      }
      if (!content) content = await fetchLinkText(url);
    } else if (!content) {
      return NextResponse.json(
        { error: "content is required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("client_context")
      .insert({
        company_id: params.id,
        kind,
        title: title || null,
        url: url || null,
        content: content || null,
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ item: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to add context" },
      { status: 500 }
    );
  }
}
