import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";
import {
  SENDPILOT_TUTORIAL_GUIDE_KEY,
  SENDPILOT_TUTORIAL_LAST_STEP,
  SALES_TUTORIAL_GUIDE_KEY,
  SALES_TUTORIAL_LAST_STEP,
} from "@/lib/sales-tutorial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["active", "paused", "completed", "dismissed"]);
type TutorialGuide = "sales" | "sendpilot";

const tutorialGuide = (value: unknown) => {
  const name = String(value || "sales").trim().toLowerCase();
  if (name === "sales") {
    return {
      name: "sales" as TutorialGuide,
      key: SALES_TUTORIAL_GUIDE_KEY,
      lastStep: SALES_TUTORIAL_LAST_STEP,
    };
  }
  if (name === "sendpilot") {
    return {
      name: "sendpilot" as TutorialGuide,
      key: SENDPILOT_TUTORIAL_GUIDE_KEY,
      lastStep: SENDPILOT_TUTORIAL_LAST_STEP,
    };
  }
  throw Object.assign(new Error("Choose a valid tutorial"), { status: 400 });
};

function responseBody(row: any, role: string, guide: TutorialGuide) {
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
    autoStart: !row && role === "sales" && guide === "sales",
    guide,
    role,
  };
}

export async function GET(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const guide = tutorialGuide(req.nextUrl.searchParams.get("guide"));
    const { data, error } = await supabaseAdmin
      .from("sales_tutorial_progress")
      .select(
        "status,current_step,last_path,completed_at,dismissed_at,updated_at"
      )
      .eq("workspace_id", scope.workspaceId)
      .eq("user_id", scope.userId)
      .eq("guide_key", guide.key)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json(responseBody(data, scope.role, guide.name), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The tutorial could not be loaded" },
      { status: Number(error?.status) === 400 ? 400 : 403 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    const guide = tutorialGuide(body.guide);
    const status = String(body.status || "");
    if (!STATUSES.has(status)) {
      return NextResponse.json(
        { error: "Choose a valid tutorial status" },
        { status: 400 }
      );
    }

    const currentStep = Math.min(
      guide.lastStep,
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
      .eq("guide_key", guide.key)
      .maybeSingle();
    if (previousError) throw previousError;

    const payload = {
      workspace_id: scope.workspaceId,
      user_id: scope.userId,
      guide_key: guide.key,
      status,
      current_step:
        status === "completed" ? guide.lastStep : currentStep,
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

    return NextResponse.json(responseBody(data, scope.role, guide.name), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The tutorial progress could not be saved" },
      { status: Number(error?.status) === 400 ? 400 : 403 }
    );
  }
}
