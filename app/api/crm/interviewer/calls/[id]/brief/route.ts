import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { loadOrCreateBrief } from "@/lib/interviewer/brief-store";
import { DEFAULT_COST_RATES, money, sessionCost } from "@/lib/interviewer/costs";
import { loadCostRates } from "@/lib/interviewer/cost-store";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const scope = await requireInterviewerOwner();
    const { data: session, error } = await supabaseAdmin
      .from("interviewer_sessions")
      .select("id, campaign_id, billable_seconds, recording_path, calendar_scheduled_at")
      .eq("id", params.id)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (error) throw error;
    if (!session) return NextResponse.json({ error: "That conversation is not on your account." }, { status: 404, headers: noStore });
    const brief = await loadOrCreateBrief(session.id);
    const loadedRates = await loadCostRates();
    const rates = loadedRates || DEFAULT_COST_RATES;
    const estimated = !loadedRates;
    const cost = sessionCost({
      connectedSeconds: Number(session.billable_seconds || 0),
      recordingBytes: 0,
      ratePerMinute: 0,
      currency: "GBP",
      rates,
    });
    return NextResponse.json({
      brief,
      hasRecording: Boolean(session.recording_path),
      scheduledAt: session.calendar_scheduled_at,
      campaignId: session.campaign_id,
      cost: {
        label: "Internal: never share with clients",
        amount: money(cost.totalGbp),
        estimated,
        voiceAgent: money(cost.voiceAgentUsd * rates.usdToGbp),
        listen: money(cost.listenUsd * rates.usdToGbp),
        llm: "Included in the Deepgram agent minute rate",
        storage: money(cost.storageUsd * rates.usdToGbp),
        vercel: money(cost.vercelUsd * rates.usdToGbp),
      },
    }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
