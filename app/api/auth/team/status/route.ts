import { personalCallsFirst } from "@/lib/personal-dashboard";
import { NextResponse } from "next/server";
import { googleConnected } from "@/lib/google";
import { microsoftConnected, microsoftConfigured } from "@/lib/microsoft";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const scope = requireRequestScope();
    const [{ data: workspace, error }, google, microsoft, callsFirst, membership] = await Promise.all([
      supabaseService
        .from("workspaces")
        .select("name")
        .eq("id", scope.workspaceId)
        .single(),
      googleConnected(scope.userId),
      microsoftConnected(scope.userId),
      personalCallsFirst(scope),
      supabaseService.from('workspace_members').select('department').eq('workspace_id', scope.workspaceId).eq('user_id', scope.userId).single(),
    ]);
    if (error) throw error;
    if (membership.error) throw membership.error;
    return NextResponse.json(
      {
        workspace: workspace.name,
        callsFirst,
        role: scope.role,
        department: membership.data.department,
        status: scope.status,
        google,
        microsoft: {
          ...microsoft,
          configured: microsoftConfigured(),
        },
        connector: google.connected
          ? { provider: "google", email: google.email }
          : microsoft.connected
            ? { provider: "microsoft", email: microsoft.email }
            : { provider: null, email: null },
        crmAccess: scope.status === "active",
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Workspace status is unavailable" },
      { status: 403 }
    );
  }
}
