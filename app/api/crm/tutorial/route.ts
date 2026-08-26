import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GUIDE_KEY = "sales_outreach_v1";
const LAST_STEP = 7;
const STATUSES = new Set(["active", "paused", "completed", "dismissed"]);

function responseBody(row: any, role: string) {
  return {
    tutorial: row
      ? {
          status: row.status,
          currentStep: Number(row.current_step) || 0,
          lastPath: row.last_path || null,
          completedAt: row.completed_at || null,
          dismissedAt: row.dismissed_at || null,
        }
      : {
          status: "not_started",
          currentStep: 0,
          lastPath: null,
          completedAt: null,
          dismissedAt: null,
        },
    autoStart: !row && role === "sales",
    role,
  };
}

export async function GET() {
  try {
    const scope = requireRequestScope();
    const { data, error } = await supabaseAdmin
      .from("sales_tutorial_progress")
      .select(
        "status,current_step,last_path,completed_at,dismissed_at,updated_at"
      )
      .eq("workspace_id", scope.workspaceId)
      .eq("user_id", scope.userId)
      .eq("guide_key", GUIDE_KEY)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json(responseBody(data, scope.role), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The tutorial could not be loaded" },
      { status: 403 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    const status = String(body.status || "");
    if (!STATUSES.has(status)) {
      return NextResponse.json(
        { error: "Choose a valid tutorial status" },
        { status: 400 }
      );
    }

    const currentStep = Math.min(
      LAST_STEP,
      Math.max(0, Math.round(Number(body.currentStep) || 0))
    );
    const rawPath = typeof body.lastPath === "string" ? body.lastPath.trim() : "";
    const lastPath = rawPath.startsWith("/crm") ? rawPath.slice(0, 300) : null;
    const now = new Date().toISOString();
    const { data: previous, error: previousError } = await supabaseAdmin
      .from("sales_tutorial_progress")
      .select("started_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("user_id", scope.userId)
      .eq("guide_key", GUIDE_KEY)
      .maybeSingle();
    if (previousError) throw previousError;

    const payload = {
      workspace_id: scope.workspaceId,
      user_id: scope.userId,
      guide_key: GUIDE_KEY,
      status,
      current_step: status === "completed" ? LAST_STEP : currentStep,
      last_path: lastPath,
      started_at: previous?.started_at || now,
      completed_at: status === "completed" ? now : null,
      dismissed_at: status === "dismissed" ? now : null,
      updated_at: now,
    };
    const { data, error } = await supabaseAdmin
      .from("sales_tutorial_progress")
      .upsert(payload, { onConflict: "workspace_id,user_id,guide_key" })
      .select("status,current_step,last_path,completed_at,dismissed_at,updated_at")
      .single();
    if (error) throw error;

    return NextResponse.json(responseBody(data, scope.role), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The tutorial progress could not be saved" },
      { status: 403 }
    );
  }
}
