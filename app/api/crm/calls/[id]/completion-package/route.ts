import { NextResponse } from "next/server";

import { loadAssignedClientAccess } from "@/lib/assigned-client-access";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fallbackCommitments(summary: any) {
  const mine = (Array.isArray(summary?.myNextActions) ? summary.myNextActions : [])
    .filter((value: unknown) => typeof value === "string" && value.trim())
    .map((text: string) => ({ text: text.trim(), ownerType: "me", ownerName: "You", dueAt: null }));
  const theirs = (Array.isArray(summary?.theirNextActions) ? summary.theirNextActions : [])
    .filter((value: unknown) => typeof value === "string" && value.trim())
    .map((raw: string) => {
      const value = raw.trim();
      const colon = value.indexOf(":");
      return {
        text: colon > 0 && colon < 80 ? value.slice(colon + 1).trim() || value : value,
        ownerType: "counterparty",
        ownerName: colon > 0 && colon < 80 ? value.slice(0, colon).trim() : "They",
        dueAt: null,
      };
    });
  return [...mine, ...theirs].slice(0, 14);
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    const { data: call, error } = await supabaseAdmin
      .from("interview_summaries")
      .select("id,session_id,company_id,summary,post_call_package,created_at")
      .eq("id", params.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .maybeSingle();
    if (error) throw error;
    if (!call?.company_id) {
      return NextResponse.json(
        { error: "This call is not linked to a company" },
        { status: 404 }
      );
    }
    const access = await loadAssignedClientAccess(call.company_id, scope);
    if (!access) {
      return NextResponse.json(
        { error: "The linked company is not available to your account" },
        { status: 403 }
      );
    }
    const saved = call.post_call_package && typeof call.post_call_package === "object"
      ? (call.post_call_package as Record<string, any>)
      : null;
    let followUp = saved?.followUp || null;
    if (!followUp && call.session_id) {
      const { data: draft } = await supabaseAdmin
        .from("follow_ups")
        .select("draft_subject,draft_body,status")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq("session_id", call.session_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (draft) {
        followUp = { subject: draft.draft_subject || "", body: draft.draft_body || "" };
      }
    }
    const packageData = saved || {
      relationship: { brief: [], playbook: [] },
      commercial: { suggestion: null, opportunityCreated: false, clarification: null, pipelineExcluded: false },
      commitments: fallbackCommitments(call.summary),
      nextFocus: { intent: null, rationale: null },
      followUp,
      generatedAt: call.created_at,
    };
    return NextResponse.json({
      company: { id: access.company.id, name: access.company.name },
      package: { ...packageData, followUp },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not load the post-call package" },
      { status: 500 }
    );
  }
}
