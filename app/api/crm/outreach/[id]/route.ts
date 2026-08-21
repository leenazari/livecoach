import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

const PRIORITIES = new Set(["high", "medium", "low"]);
const STATUSES = new Set(["imported", "queued", "ready", "contacted", "replied", "qualified", "not_interested", "suppressed"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const account = requireRequestScope();
    const body = await req.json();
    const patch: Record<string, any> = {};
    if (typeof body.priority === "string" && PRIORITIES.has(body.priority)) patch.priority = body.priority;
    if (typeof body.status === "string" && STATUSES.has(body.status)) patch.status = body.status;
    if (body.assignedToUserId === null || body.assignedToUserId === "") {
      const { data: current } = await supabaseAdmin
        .from("outreach_prospects")
        .select("assigned_to_user_id")
        .eq("id", params.id)
        .maybeSingle();
      if (
        account.role === "sales" &&
        current?.assigned_to_user_id !== account.userId
      ) {
        return NextResponse.json({ error: "You can only release your own prospect" }, { status: 403 });
      }
      patch.assigned_to_user_id = null;
    } else if (typeof body.assignedToUserId === "string") {
      const requested = body.assignedToUserId.trim();
      if (account.role === "sales" && requested !== account.userId)
        return NextResponse.json({ error: "You can only claim a prospect for yourself" }, { status: 403 });
      const { data: assignee } = await supabaseService
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", account.workspaceId)
        .eq("user_id", requested)
        .eq("status", "active")
        .maybeSingle();
      if (!assignee)
        return NextResponse.json({ error: "Choose an active team member" }, { status: 400 });
      const { data: liveDraft } = await supabaseAdmin
        .from("outreach_messages")
        .select("id,sender_user_id,status")
        .eq("prospect_id", params.id)
        .in("status", ["draft", "approved", "failed"])
        .limit(1)
        .maybeSingle();
      if (liveDraft && liveDraft.sender_user_id !== requested)
        return NextResponse.json(
          { error: "Finish or cancel the current sender's draft before reassigning this prospect" },
          { status: 409 }
        );
      patch.assigned_to_user_id = requested;
    }
    if (!Object.keys(patch).length) return NextResponse.json({ error: "no valid change supplied" }, { status: 400 });
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from("outreach_prospects").update(patch).eq("id", params.id).select("*").single();
    if (error) throw error;
    return NextResponse.json({ prospect: data });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "failed to update prospect" }, { status: 500 });
  }
}
