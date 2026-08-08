import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAGES = [
  { key: "new", label: "New", probability: 10 },
  { key: "discovery", label: "Discovery", probability: 20 },
  { key: "qualified", label: "Qualified", probability: 40 },
  { key: "proposal", label: "Proposal", probability: 60 },
  { key: "negotiation", label: "Negotiation", probability: 75 },
  { key: "verbal", label: "Verbal", probability: 90 },
];

const DAY = 24 * 60 * 60 * 1000;

export async function GET() {
  try {
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
    const [
      { data: config },
      { data: companies },
      { data: opportunities },
      { data: upcoming },
      { data: calls },
      { data: tasks },
      { count: prospectCount },
      { data: sentMessages },
      { data: outreachEvents },
    ] = await Promise.all([
      supabaseAdmin.from("app_config").select("key,value").in("key", ["revenue_target_gbp"]),
      supabaseAdmin.from("companies").select("id,name,stage,profile"),
      supabaseAdmin.from("opportunities").select("*").order("updated_at", { ascending: false }).limit(500),
      supabaseAdmin.from("upcoming_calls").select("company_id,scheduled_at").is("completed_at", null).gte("scheduled_at", now.toISOString()).order("scheduled_at", { ascending: true }).limit(500),
      supabaseAdmin.from("interview_summaries").select("company_id,created_at").not("company_id", "is", null).order("created_at", { ascending: false }).limit(2000),
      supabaseAdmin.from("tasks").select("company_id,text,due_at,kind").eq("status", "open").not("company_id", "is", null).limit(2000),
      supabaseAdmin.from("outreach_prospects").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("outreach_messages").select("prospect_id,message_tags,step_number,variant").eq("status", "sent").limit(5000),
      supabaseAdmin.from("outreach_events").select("prospect_id,kind,metadata,created_at").in("kind", ["reply", "positive_reply", "objection", "later", "referral", "meeting_booked"]).limit(5000),
    ]);

    const target = Math.max(1, Number((config || []).find((row: any) => row.key === "revenue_target_gbp")?.value) || 5_000_000);
    const nameByCompany = new Map<string, string>();
    const stageByCompany = new Map<string, string>();
    const lastTouchByCompany = new Map<string, number>();
    const nextMeetingByCompany = new Map<string, string>();
    const tasksByCompany = new Map<string, any[]>();

    for (const company of companies || []) {
      nameByCompany.set(company.id, company.name);
      if (company.stage) stageByCompany.set(company.id, company.stage);
      const emailAt = (company.profile as any)?.email_last_message_at;
      if (emailAt) lastTouchByCompany.set(company.id, new Date(emailAt).getTime());
    }
    for (const call of calls || []) {
      const at = new Date(call.created_at as string).getTime();
      if (call.company_id && at > (lastTouchByCompany.get(call.company_id) || 0)) lastTouchByCompany.set(call.company_id, at);
    }
    for (const meeting of upcoming || []) {
      if (meeting.company_id && !nextMeetingByCompany.has(meeting.company_id)) nextMeetingByCompany.set(meeting.company_id, meeting.scheduled_at);
    }
    for (const task of tasks || []) {
      if (!task.company_id) continue;
      tasksByCompany.set(task.company_id, [...(tasksByCompany.get(task.company_id) || []), task]);
    }

    const open = (opportunities || []).filter((op: any) => op.status === "open");
    const wonYtd = (opportunities || []).filter((op: any) => op.status === "won" && new Date(op.won_at || op.updated_at || op.created_at).toISOString() >= yearStart);
    const wonValue = wonYtd.reduce((sum: number, op: any) => sum + (Number(op.value) || 0), 0);
    const rawPipeline = open.reduce((sum: number, op: any) => sum + (Number(op.value) || 0), 0);
    const weightedPipeline = open.reduce((sum: number, op: any) => sum + (Number(op.value) || 0) * (Math.max(0, Math.min(100, Number(op.probability) || 0)) / 100), 0);
    const commit = open.filter((op: any) => op.forecast_category === "commit").reduce((sum: number, op: any) => sum + (Number(op.value) || 0), 0);
    const bestCase = open.filter((op: any) => ["commit", "best_case"].includes(op.forecast_category)).reduce((sum: number, op: any) => sum + (Number(op.value) || 0), 0);
    const gap = Math.max(0, target - wonValue);
    const monthsRemaining = Math.max(1, 12 - now.getUTCMonth());

    const rows = open.map((op: any) => {
      const companyId = op.company_id as string;
      const value = Number(op.value) || 0;
      const probability = Math.max(0, Math.min(100, Number(op.probability) || 0));
      const nextMeetingAt = nextMeetingByCompany.get(companyId) || null;
      const lastTouch = lastTouchByCompany.get(companyId) || null;
      const daysQuiet = lastTouch ? Math.max(0, Math.floor((Date.now() - lastTouch) / DAY)) : null;
      const risks: { code: string; label: string; severity: "high" | "medium" }[] = [];
      if (!value) risks.push({ code: "missing_value", label: "Deal value missing", severity: "high" });
      if (!op.expected_close_at) risks.push({ code: "missing_close", label: "Expected close date missing", severity: "medium" });
      if (op.expected_close_at && new Date(`${op.expected_close_at}T23:59:59`).getTime() < Date.now()) risks.push({ code: "close_overdue", label: "Expected close date passed", severity: "high" });
      if (!nextMeetingAt) risks.push({ code: "no_meeting", label: "No next meeting", severity: probability >= 60 ? "high" : "medium" });
      if (daysQuiet != null && daysQuiet >= 14) risks.push({ code: "quiet", label: `Quiet for ${daysQuiet} days`, severity: "high" });
      if (op.forecast_category === "commit" && probability < 70) risks.push({ code: "weak_commit", label: "Commit probability is below 70%", severity: "high" });
      const companyTasks = tasksByCompany.get(companyId) || [];
      const overdue = companyTasks.filter((task: any) => task.due_at && new Date(task.due_at).getTime() < Date.now());
      if (overdue.length) risks.push({ code: "overdue_actions", label: `${overdue.length} overdue action${overdue.length === 1 ? "" : "s"}`, severity: "high" });

      let nextAction = companyTasks.find((task: any) => task.due_at)?.text || companyTasks[0]?.text || "";
      if (!nextAction && !value) nextAction = "Set a realistic opportunity value";
      else if (!nextAction && !nextMeetingAt) nextAction = "Secure the next decision-focused meeting";
      else if (!nextAction && op.pipeline_stage === "discovery") nextAction = "Confirm buyer need, urgency and decision process";
      else if (!nextAction) nextAction = "Agree the next mutual commitment";

      const riskWeight = risks.reduce((sum, risk) => sum + (risk.severity === "high" ? 30 : 12), 0);
      const actionScore = riskWeight + probability + Math.min(50, value / 20_000);
      return {
        ...op,
        value,
        probability,
        weightedValue: value * probability / 100,
        company: nameByCompany.get(companyId) || "a client",
        relationshipStage: stageByCompany.get(companyId) || null,
        nextMeetingAt,
        daysQuiet,
        risks,
        nextAction,
        actionScore,
      };
    }).sort((a: any, b: any) => b.actionScore - a.actionScore);

    const stages = STAGES.map((stage) => {
      const members = rows.filter((row: any) => row.pipeline_stage === stage.key);
      return {
        ...stage,
        count: members.length,
        value: members.reduce((sum: number, row: any) => sum + row.value, 0),
        weighted: members.reduce((sum: number, row: any) => sum + row.weightedValue, 0),
      };
    });

    const uniqueSent = new Set((sentMessages || []).map((row: any) => row.prospect_id).filter(Boolean));
    const replyKinds = new Set(["reply", "positive_reply", "objection", "later", "referral"]);
    const replied = new Set((outreachEvents || []).filter((event: any) => replyKinds.has(event.kind)).map((event: any) => event.prospect_id).filter(Boolean));
    const positive = new Set((outreachEvents || []).filter((event: any) => event.kind === "positive_reply").map((event: any) => event.prospect_id).filter(Boolean));
    const booked = new Set((outreachEvents || []).filter((event: any) => event.kind === "meeting_booked").map((event: any) => event.prospect_id).filter(Boolean));
    const outreachOpps = (opportunities || []).filter((op: any) => op.source === "outreach");

    return NextResponse.json({
      goal: { target, wonYtd: wonValue, gap, monthsRemaining, requiredPerMonth: gap / monthsRemaining },
      kpis: { rawPipeline, weightedPipeline, commit, bestCase, wonYtd: wonValue, coverage: gap ? rawPipeline / gap : 0 },
      stages,
      opportunities: rows,
      priorities: rows.slice(0, 8),
      funnel: [
        { key: "prospects", label: "Prospects", value: prospectCount || 0 },
        { key: "contacted", label: "Contacted", value: uniqueSent.size },
        { key: "replied", label: "Replied", value: replied.size },
        { key: "positive", label: "Positive", value: positive.size },
        { key: "booked", label: "Meetings", value: booked.size },
        { key: "opportunities", label: "Opportunities", value: outreachOpps.length },
        { key: "won", label: "Won", value: outreachOpps.filter((op: any) => op.status === "won").length },
      ],
      stageDefinitions: STAGES,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to load revenue pipeline" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const target = Math.round(Number(body.target));
    if (!Number.isFinite(target) || target < 1_000 || target > 1_000_000_000) {
      return NextResponse.json({ error: "Enter a revenue target between £1,000 and £1 billion" }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("app_config").upsert({
      key: "revenue_target_gbp",
      value: String(target),
      note: "Annual revenue target used by the revenue command centre",
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, target });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to save revenue target" }, { status: 500 });
  }
}

