import { NextRequest, NextResponse } from "next/server";
import { sanitizeOutreachSequence } from "@/lib/outreach-sequence";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const account = requireRequestScope();
    if (account.role !== "owner" && account.role !== "manager") {
      return NextResponse.json(
        { error: "Only a workspace owner or manager can edit campaigns" },
        { status: 403 }
      );
    }
    const body = await req.json();
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const key of ["name", "goal", "audience", "offer_angle"]) if (typeof body[key] === "string" && body[key].trim()) patch[key] = body[key].trim();
    if (["draft", "active", "paused", "completed"].includes(body.status)) patch.status = body.status;
    if (body.daily_limit != null) patch.daily_limit = Math.min(20, Math.max(1, Number(body.daily_limit) || 20));
    if (Array.isArray(body.sequence)) {
      const result = sanitizeOutreachSequence(body.sequence);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      patch.sequence = result.sequence;
    }
    if (body.voice && typeof body.voice === "object") {
      // This legacy field describes campaign writing only. Keep an explicit
      // allowlist so a campaign can never store or override a salesperson's
      // ElevenLabs audio voice.
      patch.voice = {
        tone: String(body.voice.tone || "warm, commercially curious and concise").trim().slice(0, 300),
        style: String(body.voice.style || "founder-to-founder, plain English and respectful").trim().slice(0, 500),
        rules: Array.isArray(body.voice.rules) ? body.voice.rules.map((rule: any) => String(rule).trim().slice(0, 240)).filter(Boolean).slice(0, 12) : [],
        signature: String(body.voice.signature || "Lee").trim().slice(0, 80),
      };
    }
    if (Array.isArray(body.banned_phrases)) {
      patch.banned_phrases = body.banned_phrases.map((phrase: any) => String(phrase).trim().toLowerCase().slice(0, 100)).filter(Boolean).slice(0, 30);
    }
    // Campaign booking links are legacy data and are never written or used.
    // Each salesperson owns their link in My Sales Setup.
    if (["interested_reply", "final_step", "always", "never"].includes(body.booking_cta_mode)) patch.booking_cta_mode = body.booking_cta_mode;
    // Approval mode is deliberately locked on for this first safe release.
    patch.approval_mode = true;
    const { data, error } = await supabaseAdmin
      .from("outreach_campaigns")
      .update(patch)
      .eq("workspace_id", account.workspaceId)
      .eq("id", params.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    return NextResponse.json({ campaign: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to update campaign" }, { status: 500 });
  }
}
