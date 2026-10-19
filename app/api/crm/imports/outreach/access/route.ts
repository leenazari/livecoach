import { NextResponse } from "next/server";

import { requireOutreachImportAccess } from "@/lib/outreach-import-access";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep this small and independent of prospects/history. A failed prospect
// query must not remove the uploader's entry point or appear to revoke access.
export async function GET() {
  try {
    const scope = await requireOutreachImportAccess();
    const canAssignImports = scope.role === "owner";
    let team: { userId: string; name: string }[] = [];
    if (canAssignImports) {
      const { data: members, error: memberError } = await supabaseService
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", scope.workspaceId)
        .eq("status", "active")
        .order("created_at");
      if (memberError) throw memberError;
      const ids = (members || []).map((member) => member.user_id);
      if (ids.length) {
        const { data: profiles, error } = await supabaseService
          .from("profiles")
          .select("user_id,display_name")
          .in("user_id", ids);
        if (error) throw error;
        const names = new Map((profiles || []).map((profile) => [profile.user_id, profile.display_name]));
        team = ids.map((userId) => ({ userId, name: names.get(userId) || "Team member" }));
      }
    }
    return NextResponse.json(
      { currentUser: scope.userId, canAssignImports, team },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    const forbidden = /membership|workspace access|authenticated/i.test(error?.message || "");
    return NextResponse.json(
      { error: forbidden ? "Active workspace membership is required to import your own leads" : "Could not check lead upload access. Please retry." },
      { status: forbidden ? 403 : 503, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
