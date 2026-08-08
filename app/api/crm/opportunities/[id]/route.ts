import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// PATCH  /api/crm/opportunities/:id -> update status (open|won|lost|dismissed)
//        or edit title/detail/value.
// DELETE /api/crm/opportunities/:id
const STATUSES = ["open", "won", "lost", "dismissed"];
const OWNER_TYPES = ["us", "buyer", "joint"];
const PIPELINE_STAGES = ["new", "discovery", "qualified", "proposal", "negotiation", "verbal", "won", "lost"];
const FORECAST_CATEGORIES = ["pipeline", "best_case", "commit", "omitted"];
const OPPORTUNITY_TYPES = ["revenue", "investment", "internal", "strategic"];

const cleanClosePlan = (value: any) => {
  const targetCloseDate =
    typeof value?.targetCloseDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.targetCloseDate)
      ? value.targetCloseDate
      : null;
  const milestones = Array.isArray(value?.milestones)
    ? value.milestones
        .filter((m: any) => m && typeof m.label === "string" && m.label.trim())
        .slice(0, 20)
        .map((m: any) => ({
          id:
            typeof m.id === "string" && m.id.trim()
              ? m.id.trim().slice(0, 80)
              : crypto.randomUUID(),
          label: m.label.trim().slice(0, 200),
          owner: OWNER_TYPES.includes(m.owner) ? m.owner : "joint",
          dueAt:
            typeof m.dueAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.dueAt)
              ? m.dueAt
              : null,
          status: m.status === "done" ? "done" : "pending",
        }))
    : [];
  return { targetCloseDate, milestones };
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const patch: Record<string, any> = {};
    if (typeof body.status === "string" && STATUSES.includes(body.status)) {
      patch.status = body.status;
    }
    if (typeof body.title === "string" && body.title.trim()) {
      patch.title = body.title.trim();
    }
    if (typeof body.detail === "string") patch.detail = body.detail.trim() || null;
    if (typeof body.value === "number") patch.value = body.value;
    if (body.value === null) patch.value = null;
    if (typeof body.pipelineStage === "string" && PIPELINE_STAGES.includes(body.pipelineStage)) {
      patch.pipeline_stage = body.pipelineStage;
    }
    if (body.probability != null) {
      const probability = Math.round(Number(body.probability));
      if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
        return NextResponse.json({ error: "probability must be between 0 and 100" }, { status: 400 });
      }
      patch.probability = probability;
    }
    if (typeof body.forecastCategory === "string" && FORECAST_CATEGORIES.includes(body.forecastCategory)) {
      patch.forecast_category = body.forecastCategory;
    }
    if (typeof body.opportunityType === "string" && OPPORTUNITY_TYPES.includes(body.opportunityType)) {
      patch.opportunity_type = body.opportunityType;
      if (body.opportunityType !== "revenue" && body.forecastCategory == null) {
        patch.forecast_category = "omitted";
      }
    }
    if (body.expectedCloseAt === null || body.expectedCloseAt === "") {
      patch.expected_close_at = null;
    } else if (typeof body.expectedCloseAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.expectedCloseAt)) {
      patch.expected_close_at = body.expectedCloseAt;
    }
    if (typeof body.outcomeReason === "string") patch.outcome_reason = body.outcomeReason.trim().slice(0, 1000) || null;
    if (body.closePlan && typeof body.closePlan === "object") {
      patch.close_plan = cleanClosePlan(body.closePlan);
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();
    if (patch.status === "won") {
      patch.pipeline_stage = "won";
      patch.probability = 100;
      patch.forecast_category = "commit";
      patch.won_at = patch.updated_at;
      patch.lost_at = null;
    } else if (patch.status === "lost") {
      patch.pipeline_stage = "lost";
      patch.probability = 0;
      patch.forecast_category = "omitted";
      patch.lost_at = patch.updated_at;
      patch.won_at = null;
    } else if (patch.status === "open") {
      patch.won_at = null;
      patch.lost_at = null;
    }
    const { data, error } = await supabaseAdmin
      .from("opportunities")
      .update(patch)
      .eq("id", params.id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ opportunity: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to update opportunity" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from("opportunities")
      .delete()
      .eq("id", params.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json({ error: "opportunity not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to delete opportunity" },
      { status: 500 }
    );
  }
}
