import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

export async function PATCH(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    if (!UUID.test(context.params.id)) {
      return NextResponse.json(
        { error: "message id is invalid" },
        { status: 400, headers: noStore }
      );
    }
    const body = await request.json().catch(() => ({}));
    if (body.status !== "reviewed") {
      return NextResponse.json(
        { error: "status must be reviewed" },
        { status: 400, headers: noStore }
      );
    }
    const reviewedAt = new Date().toISOString();
    const { data, error } = await supabaseService
      .from("linkedin_inbox_messages")
      .update({ status: "reviewed", reviewed_at: reviewedAt })
      .eq("id", context.params.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("status", "review")
      .select("id,status,reviewed_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "message was not found or was already reviewed" },
        { status: 404, headers: noStore }
      );
    }
    return NextResponse.json({ message: data }, { headers: noStore });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not review that LinkedIn message" },
      { status: 500, headers: noStore }
    );
  }
}
