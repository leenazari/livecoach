import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { ensureWorkspaceProfileId } from "@/lib/workspace-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AiMode = "economical" | "balanced" | "high";
const MODES = new Set<AiMode>(["economical", "balanced", "high"]);

export async function GET() {
  try {
    const profileId = await ensureWorkspaceProfileId();
    const { data, error } = await supabaseAdmin
      .from("workspace_profile")
      .select("ai_mode")
      .eq("id", profileId)
      .maybeSingle();
    if (error) throw error;
    const mode = MODES.has(data?.ai_mode as AiMode)
      ? (data?.ai_mode as AiMode)
      : "balanced";
    return NextResponse.json({ mode });
  } catch (err: any) {
    return NextResponse.json(
      { mode: "balanced", error: err?.message || "failed to load mode" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const profileId = await ensureWorkspaceProfileId();
    const body = await req.json();
    const mode = body?.mode as AiMode;
    if (!MODES.has(mode))
      return NextResponse.json({ error: "invalid mode" }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from("workspace_profile")
      .upsert(
        { id: profileId, ai_mode: mode, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      )
      .select("ai_mode")
      .single();
    if (error) throw error;
    if (data?.ai_mode !== mode) throw new Error("database did not confirm AI mode");
    return NextResponse.json({ mode: data.ai_mode });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to save mode" },
      { status: 500 }
    );
  }
}
