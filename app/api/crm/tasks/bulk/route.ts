import { NextRequest, NextResponse } from "next/server";

import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Dismiss a bounded set of the signed-in user's tasks. Dismissal is deliberately
// recoverable and retains each task fingerprint, so background jobs cannot
// recreate the same stale item after the user cleans it up.
export async function POST(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const body = await req.json();
    const requested = Array.isArray(body.taskIds) ? body.taskIds : [];
    const taskIds = [...new Set(requested
      .filter((id: unknown): id is string => typeof id === "string" && UUID.test(id))
      .slice(0, 300))];
    if (!taskIds.length) {
      return NextResponse.json({ error: "Choose at least one to-do" }, { status: 400 });
    }
    if (requested.length > 300 || taskIds.length !== requested.length) {
      return NextResponse.json({ error: "The selected to-do list is not valid" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("tasks")
      .update({ status: "dismissed" })
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .eq("status", "open")
      .in("id", taskIds)
      .select("id");
    if (error) throw error;
    const updatedIds = (data || []).map((row) => row.id);
    return NextResponse.json(
      {
        ok: true,
        updatedIds,
        skippedIds: taskIds.filter((id) => !updatedIds.includes(id)),
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The selected to-dos could not be removed" },
      { status: 500 }
    );
  }
}
