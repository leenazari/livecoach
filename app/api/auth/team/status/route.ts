import { NextResponse } from "next/server";
import { googleConnected } from "@/lib/google";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const scope = requireRequestScope();
    const [{ data: workspace, error }, google] = await Promise.all([
      supabaseService
        .from("workspaces")
        .select("name")
        .eq("id", scope.workspaceId)
        .single(),
      googleConnected(scope.userId),
    ]);
    if (error) throw error;
    return NextResponse.json(
      {
        workspace: workspace.name,
        role: scope.role,
        status: scope.status,
        google,
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
