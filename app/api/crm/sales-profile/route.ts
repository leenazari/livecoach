import { NextRequest, NextResponse } from "next/server";
import { googleConnected } from "@/lib/google";
import { microsoftConnected } from "@/lib/microsoft";
import { requireRequestScope } from "@/lib/request-scope";
import {
  clearSalesProfileCache,
  getSalesProfile,
  validateSalesProfileInput,
} from "@/lib/sales-profile";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { deriveTranscriberName } from "@/lib/transcriber";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function identityForUser(userId: string) {
  const [{ data: profile, error }, google, microsoft] = await Promise.all([
    supabaseService
      .from("profiles")
      .select("display_name,email,transcriber_name")
      .eq("user_id", userId)
      .maybeSingle(),
    googleConnected(userId),
    microsoftConnected(userId),
  ]);
  if (error) throw error;
  return {
    displayName: profile?.display_name || "",
    accountEmail: profile?.email || "",
    transcriberName:
      profile?.transcriber_name ||
      deriveTranscriberName(profile?.display_name || null),
    connector: google.connected
      ? { provider: "google" as const, email: google.email }
      : microsoft.connected
        ? { provider: "microsoft" as const, email: microsoft.email }
        : { provider: null, email: null },
  };
}

export async function GET() {
  try {
    const scope = requireRequestScope();
    const [profile, identity] = await Promise.all([
      getSalesProfile(scope),
      identityForUser(scope.userId),
    ]);
    return NextResponse.json(
      { profile, identity },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Your sales setup could not be loaded" },
      { status: 403 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const input = validateSalesProfileInput(await req.json());
    const now = new Date().toISOString();
    const previous = await getSalesProfile(scope);
    const payload = {
      workspace_id: scope.workspaceId,
      user_id: scope.userId,
      role_title: input.roleTitle,
      sales_goal: input.salesGoal || null,
      email_tone: input.emailTone,
      email_signoff: input.emailSignoff || null,
      outreach_voice_id: input.outreachVoiceId || null,
      outreach_voice_name: input.outreachVoiceName || null,
      coaching_style: input.coachingStyle,
      suggestion_frequency: input.suggestionFrequency,
      product_focus: input.productFocus,
      customer_focus: input.customerFocus,
      workday_start: input.workdayStart,
      workday_end: input.workdayEnd,
      timezone: input.timezone,
      personal_context: input.personalContext || null,
      completed_at: previous.completedAt || now,
      updated_at: now,
    };
    const { error } = await supabaseAdmin
      .from("salesperson_profiles")
      .upsert(payload, { onConflict: "workspace_id,user_id" });
    if (error) throw error;

    clearSalesProfileCache(scope);
    const [profile, identity] = await Promise.all([
      getSalesProfile(scope),
      identityForUser(scope.userId),
    ]);
    return NextResponse.json(
      { profile, identity },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    const message = error?.message || "Your sales setup was not saved";
    const status = /add |choose |finish time/i.test(message) ? 400 : 403;
    return NextResponse.json({ error: message }, { status });
  }
}
