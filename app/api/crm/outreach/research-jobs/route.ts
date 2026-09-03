import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";

import { processOutreachResearchJobs } from "@/app/api/crm/outreach/research-jobs/processor";
import { londonDate } from "@/lib/outreach";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";
import { outreachSequenceStepAt } from "@/lib/outreach-sequence";
import { internalAppOrigin } from "@/lib/public-app-url";
import { resolveRecordScope } from "@/lib/record-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BATCH_SIZE = 50;

type JobStatus = "queued" | "running" | "completed" | "failed";

function publicJob(job: any) {
  return {
    id: job.id,
    prospectId: job.prospect_id,
    enrolmentId: job.enrolment_id,
    messageId: job.message_id || job.result_message_id || null,
    stepNumber: Number(job.step_number) || 1,
    kind: job.job_kind,
    status: job.status as JobStatus,
    attempts: Number(job.attempt_count) || 0,
    maxAttempts: Number(job.max_attempts) || 3,
    availableAt: job.available_at,
    requestedAt: job.requested_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    error: job.last_error || null,
    httpStatus: job.last_http_status || null,
    updatedAt: job.updated_at,
  };
}

function jobResponse(rows: any[]) {
  const jobs = rows.map(publicJob);
  return {
    jobs,
    summary: {
      total: jobs.length,
      queued: jobs.filter((job) => job.status === "queued").length,
      running: jobs.filter((job) => job.status === "running").length,
      completed: jobs.filter((job) => job.status === "completed").length,
      failed: jobs.filter((job) => job.status === "failed").length,
    },
    revision: jobs.reduce(
      (latest, job) =>
        String(job.updatedAt || "") > latest ? String(job.updatedAt) : latest,
      ""
    ),
  };
}

async function loadJobs(account: { userId: string; workspaceId: string }) {
  const recent = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("outreach_research_jobs")
    .select(
      "id,prospect_id,enrolment_id,message_id,result_message_id,step_number,job_kind,status,attempt_count,max_attempts,available_at,requested_at,started_at,completed_at,last_error,last_http_status,updated_at"
    )
    .eq("workspace_id", account.workspaceId)
    .eq("owner_id", account.userId)
    .or(`status.in.(queued,running),updated_at.gte.${recent}`)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}

function startWorker(
  request: NextRequest,
  account: { userId: string; workspaceId: string }
) {
  const origin = internalAppOrigin(request.nextUrl.origin);
  const authCookie = request.headers.get("cookie") || undefined;
  waitUntil(
    processOutreachResearchJobs({ account, origin, authCookie }).catch(
      (error: any) => {
        console.error(
          JSON.stringify({
            level: "error",
            msg: "outreach research worker failed",
            userId: account.userId,
            error: error?.message || "unknown error",
          })
        );
      }
    )
  );
}

export async function GET() {
  try {
    const account = await resolveRecordScope();
    return NextResponse.json({
      ok: true,
      ...jobResponse(await loadJobs(account)),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Research progress could not be loaded" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const account = await resolveRecordScope();
    const body = await request.json().catch(() => ({}));
    const rawIds = Array.isArray(body?.prospectIds) ? body.prospectIds : [];
    const prospectIds: string[] = [
      ...new Set<string>(
        rawIds
          .map((value: unknown) => String(value || "").trim())
          .filter(Boolean)
      ),
    ];
    if (prospectIds.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: "Choose no more than 50 people for one research batch" },
        { status: 400 }
      );
    }
    if (!prospectIds.length && body?.resume !== true) {
      return NextResponse.json(
        { error: "Choose at least one person to research" },
        { status: 400 }
      );
    }

    // This also repairs a missing profile sender from this exact user's
    // verified mailbox before any paid model call can begin.
    await resolveOutreachIdentity(account.userId);

    const errors: Array<{ prospectId: string; error: string }> = [];
    const skipped: Array<{ prospectId: string; reason: string }> = [];
    let queuedRows: any[] = [];

    if (prospectIds.length) {
      const { data: prospects, error: prospectError } = await supabaseAdmin
        .from("outreach_prospects")
        .select("id,assigned_to_user_id")
        .eq("workspace_id", account.workspaceId)
        .in("id", prospectIds);
      if (prospectError) throw prospectError;
      const prospectMap = new Map(
        (prospects || []).map((prospect: any) => [prospect.id, prospect])
      );

      const { data: enrolments, error: enrolmentError } = await supabaseAdmin
        .from("outreach_enrolments")
        .select("id,prospect_id,campaign_id,current_step,status,queued_for")
        .eq("workspace_id", account.workspaceId)
        .eq("queued_for", londonDate())
        .in("status", ["queued", "researched", "drafted"])
        .in("prospect_id", prospectIds);
      if (enrolmentError) throw enrolmentError;

      const enrolmentsByProspect = new Map<string, any[]>();
      for (const enrolment of enrolments || []) {
        const rows = enrolmentsByProspect.get(enrolment.prospect_id) || [];
        rows.push(enrolment);
        enrolmentsByProspect.set(enrolment.prospect_id, rows);
      }
      const enrolmentIds = (enrolments || []).map((row: any) => row.id);
      const campaignIds = [
        ...new Set((enrolments || []).map((row: any) => row.campaign_id)),
      ];
      const [
        { data: messages, error: messageError },
        { data: campaigns, error: campaignError },
      ] = await Promise.all([
          enrolmentIds.length
            ? supabaseAdmin
                .from("outreach_messages")
                .select(
                  "id,enrolment_id,prospect_id,step_number,status,voice_script,sender_user_id"
                )
                .eq("workspace_id", account.workspaceId)
                .in("enrolment_id", enrolmentIds)
            : Promise.resolve({ data: [], error: null }),
          campaignIds.length
            ? supabaseAdmin
                .from("outreach_campaigns")
                .select("id,status,sequence")
                .eq("workspace_id", account.workspaceId)
                .in("id", campaignIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
      if (messageError) throw messageError;
      if (campaignError) throw campaignError;
      const campaignMap = new Map(
        (campaigns || []).map((campaign: any) => [campaign.id, campaign])
      );
      const messagesByEnrolment = new Map<string, any[]>();
      for (const message of messages || []) {
        const rows = messagesByEnrolment.get(message.enrolment_id) || [];
        rows.push(message);
        messagesByEnrolment.set(message.enrolment_id, rows);
      }

      const requestedJobs: Array<Record<string, unknown>> = [];
      for (const prospectId of prospectIds) {
        const prospect = prospectMap.get(prospectId);
        if (!prospect) {
          errors.push({
            prospectId,
            error: "This prospect is missing or is not visible to your account",
          });
          continue;
        }
        if (prospect.assigned_to_user_id !== account.userId) {
          errors.push({
            prospectId,
            error: "Assign this prospect to yourself before starting research",
          });
          continue;
        }
        const matchingEnrolments = enrolmentsByProspect.get(prospectId) || [];
        if (matchingEnrolments.length !== 1) {
          errors.push({
            prospectId,
            error: matchingEnrolments.length
              ? "This person has more than one active item in today's queue"
              : "This person is not in today's active queue",
          });
          continue;
        }
        const enrolment = matchingEnrolments[0];
        const campaign = campaignMap.get(enrolment.campaign_id);
        if (!campaign || campaign.status !== "active") {
          errors.push({
            prospectId,
            error: "Activate this person's campaign before starting research",
          });
          continue;
        }
        const stepNumber = Number(enrolment.current_step) || 1;
        const sequenceStep = outreachSequenceStepAt(
          campaign.sequence,
          stepNumber
        );
        if ((sequenceStep?.channel || "email") !== "email") {
          errors.push({
            prospectId,
            error: "Complete this manual LinkedIn or phone step from Today first",
          });
          continue;
        }
        const message = (messagesByEnrolment.get(enrolment.id) || []).find(
          (row: any) => Number(row.step_number) === stepNumber
        );
        if (!message && enrolment.status === "queued") {
          requestedJobs.push({
            prospect_id: prospectId,
            enrolment_id: enrolment.id,
            message_id: null,
            step_number: stepNumber,
            job_kind: "full_draft",
          });
          continue;
        }
        if (
          message &&
          message.sender_user_id === account.userId &&
          ["draft", "failed"].includes(message.status) &&
          !String(message.voice_script || "").trim()
        ) {
          requestedJobs.push({
            prospect_id: prospectId,
            enrolment_id: enrolment.id,
            message_id: message.id,
            step_number: stepNumber,
            job_kind: "voice_script",
          });
          continue;
        }
        skipped.push({
          prospectId,
          reason: "This draft is already ready to review",
        });
      }

      if (requestedJobs.length) {
        const { data, error: enqueueError } = await supabaseAdmin.rpc(
          "enqueue_outreach_research_jobs",
          {
            p_workspace_id: account.workspaceId,
            p_owner_id: account.userId,
            p_jobs: requestedJobs,
          }
        );
        if (enqueueError) throw enqueueError;
        queuedRows = Array.isArray(data) ? data : [];
        const savedProspects = new Set(
          queuedRows.map((row: any) => row.prospect_id)
        );
        for (const job of requestedJobs) {
          const prospectId = String(job.prospect_id);
          if (!savedProspects.has(prospectId)) {
            errors.push({
              prospectId,
              error:
                "LiveCoach could not confirm this exact assigned queue item. Refresh Today and try it once more.",
            });
          }
        }
      }
    }

    startWorker(request, account);
    const visibleRows = await loadJobs(account);
    return NextResponse.json(
      {
        ok: true,
        accepted: queuedRows.length,
        errors,
        skipped,
        ...jobResponse(visibleRows),
      },
      { status: 202 }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        error:
          error?.message ||
          "Research could not be queued. Refresh Today and try once more.",
      },
      { status: 500 }
    );
  }
}
