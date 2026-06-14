import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

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
    const { data, error } = await supabaseAdmin
      .from("client_context")
      .select("*")
      .eq("company_id", params.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ items: data || [] });
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
