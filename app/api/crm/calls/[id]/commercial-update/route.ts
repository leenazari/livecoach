import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { upsertTasks } from "@/lib/tasks";
import { capitaliseSentenceStarts } from "@/lib/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAGES = ["new", "discovery", "qualified", "proposal", "negotiation", "verbal", "won", "lost"];
const OWNERS = ["us", "buyer", "joint"];
const DEFAULT_PROBABILITY: Record<string, number> = {
  new: 10,
  discovery: 20,
  qualified: 40,
  proposal: 60,
  negotiation: 75,
  verbal: 90,
  won: 100,
  lost: 0,
};

const suggestedAction = (summary: any): string => {
  const sources = [summary?.myNextActions, summary?.suggestedNextActions];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    const first = source.find((value: any) => typeof value === "string" && value.trim());
    if (first) return first.trim().slice(0, 500);
  }
  return "";
};

async function callContext(callId: string) {
  const { data: call, error } = await supabaseAdmin
    .from("interview_summaries")
    .select("id, session_id, company_id, candidate, summary")
    .eq("id", callId)
    .single();
  if (error || !call?.company_id) return null;
  const [{ data: company }, { data: opportunities }] = await Promise.all([
    supabaseAdmin.from("companies").select("id, name").eq("id", call.company_id).single(),
    supabaseAdmin
      .from("opportunities")
      .select("*")
      .eq("company_id", call.company_id)
      .eq("opportunity_type", "revenue")
      .order("updated_at", { ascending: false })
      .limit(20),
  ]);
  return {
    call,
    company,
    opportunities: (opportunities || []).filter(
      (opportunity: any) =>
        opportunity.status === "open" ||
        (!!call.session_id && opportunity.session_id === call.session_id)
    ),
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const context = await callContext(params.id);
    if (!context) return NextResponse.json({ error: "This call is not linked to a company" }, { status: 404 });
    return NextResponse.json({
      company: context.company,
      opportunities: context.opportunities,
      suggestion: suggestedAction(context.call.summary),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not load the commercial update" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const context = await callContext(params.id);
    if (!context) return NextResponse.json({ error: "This call is not linked to a company" }, { status: 404 });

    const pipelineStage = STAGES.includes(body.pipelineStage) ? body.pipelineStage : "discovery";
    const nextActionOwner = OWNERS.includes(body.nextActionOwner) ? body.nextActionOwner : "us";
    const nextAction = typeof body.nextAction === "string"
      ? capitaliseSentenceStarts(body.nextAction.trim()).slice(0, 500)
      : "";
    const dueDate = typeof body.nextActionDueAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.nextActionDueAt)
      ? body.nextActionDueAt
      : null;
    const probabilityValue = Math.round(Number(body.probability));
    const probability = Number.isFinite(probabilityValue) && probabilityValue >= 0 && probabilityValue <= 100
      ? probabilityValue
      : DEFAULT_PROBABILITY[pipelineStage];
    const valueNumber = Number(body.value);
    const value = Number.isFinite(valueNumber) && valueNumber >= 0 ? valueNumber : null;
    const now = new Date().toISOString();
    const status = pipelineStage === "won" ? "won" : pipelineStage === "lost" ? "lost" : "open";
    const forecastCategory = pipelineStage === "won" || pipelineStage === "verbal"
      ? "commit"
      : pipelineStage === "lost"
        ? "omitted"
        : ["proposal", "negotiation"].includes(pipelineStage)
          ? "best_case"
          : "pipeline";
    const patch = {
      company_id: context.call.company_id,
      status,
      opportunity_type: "revenue",
      pipeline_stage: pipelineStage,
      probability,
      forecast_category: forecastCategory,
      value,
      next_action: status === "open" ? nextAction || null : null,
      next_action_due_at: status === "open" && dueDate ? `${dueDate}T12:00:00Z` : null,
      next_action_owner: nextActionOwner,
      updated_at: now,
      won_at: status === "won" ? now : null,
      lost_at: status === "lost" ? now : null,
    };

    const opportunityId = typeof body.opportunityId === "string" ? body.opportunityId : "";
    let opportunity: any;
    if (opportunityId) {
      const { data, error } = await supabaseAdmin
        .from("opportunities")
        .update(patch)
        .eq("id", opportunityId)
        .eq("company_id", context.call.company_id)
        .select()
        .single();
      if (error) throw error;
      opportunity = data;
    } else {
      const title = typeof body.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, 180)
        : `${context.company?.name || "Client"} opportunity`;
      const { data, error } = await supabaseAdmin
        .from("opportunities")
        .insert({
          ...patch,
          title,
          source: "post_call",
          session_id: context.call.session_id || null,
          surfaced_by_ai: false,
        })
        .select()
        .single();
      if (error) throw error;
      opportunity = data;
    }

    if (nextAction && status === "open") {
      await upsertTasks(context.call.company_id, [{
        text: nextAction,
        kind: nextActionOwner === "buyer" ? "counterparty_commitment" : "next_step",
        linkKind: "client",
        source: "post_call",
        sourceRef: context.call.session_id || context.call.id,
        dueAt: dueDate ? `${dueDate}T12:00:00Z` : null,
        payload: {
          ownerType: nextActionOwner === "buyer" ? "counterparty" : nextActionOwner,
          ownerName: nextActionOwner === "buyer" ? "Buyer" : nextActionOwner === "joint" ? "Joint" : "You",
          opportunityId: opportunity.id,
        },
      }]);
    }

    return NextResponse.json({ opportunity, taskCreated: !!nextAction && status === "open" });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not save the commercial update" }, { status: 500 });
  }
}
