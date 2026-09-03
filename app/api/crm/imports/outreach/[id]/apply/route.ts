import { NextRequest, NextResponse } from "next/server";

import { requireWorkspaceOwner } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireWorkspaceOwner();
    const body = await request.json().catch(() => ({}));
    if (body.confirmed !== true) {
      return NextResponse.json(
        { error: "Review the staged rows and confirm the import first" },
        { status: 400 }
      );
    }
    const { data, error } = await supabaseService.rpc(
      "apply_outreach_import_batch_service",
      {
        p_workspace_id: scope.workspaceId,
        p_actor_user_id: scope.userId,
        p_batch_id: params.id,
      }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true, result: data });
  } catch (error: any) {
    const message = error?.message || "Could not apply this import";
    return NextResponse.json(
      { error: message },
      { status: /owner access/i.test(message) ? 403 : /not found|expired|no longer/i.test(message) ? 409 : 500 }
    );
  }
}
