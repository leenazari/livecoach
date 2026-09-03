import { NextResponse } from "next/server";

import { requireWorkspaceOwner } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const scope = requireWorkspaceOwner();
    const { data, error } = await supabaseService
      .from("crm_import_batches")
      .select(
        "id,source_name,status,row_count,ready_count,duplicate_count,review_count,invalid_count,rows,applied_result,assigned_to_user_id,applied_at,undone_at,expires_at,created_at"
      )
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) throw error;
    return NextResponse.json(
      { batches: data || [] },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    const forbidden = /owner access/i.test(error?.message || "");
    return NextResponse.json(
      { error: error?.message || "Could not load staged imports" },
      { status: forbidden ? 403 : 500 }
    );
  }
}
