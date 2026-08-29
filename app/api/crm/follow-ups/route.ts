import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";

// POST /api/crm/follow-ups -> create a follow-up draft (e.g. saving a draft the
// assistant wrote). { companyId, draft_subject?, draft_body }.
export async function POST(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const { companyId, draft_subject, draft_body } = await req.json();
    if (
      typeof companyId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId)
    ) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }
    if (typeof draft_body !== "string" || !draft_body.trim()) {
      return NextResponse.json({ error: "draft_body is required" }, { status: 400 });
    }
    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }
    const { data, error } = await supabaseAdmin
      .from("follow_ups")
      .insert({
        company_id: companyId,
        workspace_id: account.workspaceId,
        owner_id: account.userId,
        visibility: "private",
        draft_subject:
          typeof draft_subject === "string" && draft_subject.trim()
            ? draft_subject.trim()
            : "Follow-up",
        draft_body: draft_body.trim(),
        status: "draft",
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ followUp: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to save follow-up" },
      { status: 500 }
    );
  }
}
