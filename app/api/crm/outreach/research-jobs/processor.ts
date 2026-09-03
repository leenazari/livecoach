import "server-only";

import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

import { POST as prepareOutreach } from "@/app/api/crm/outreach/[id]/prepare/route";
import { POST as createOutreachVoiceScript } from "@/app/api/crm/outreach/messages/[id]/voice-script/route";
import { runWithServiceRecordScope } from "@/lib/service-scope";
import { supabaseService } from "@/lib/supabase";

const ACCOUNT_CONCURRENCY = 2;
const DEFAULT_WORK_BUDGET_MS = 225_000;
const MAX_JOBS_PER_INVOCATION = 50;

type AccountScope = {
  userId: string;
  workspaceId: string;
};

type ResearchJob = {
  id: string;
  workspace_id: string;
  owner_id: string;
  prospect_id: string;
  enrolment_id: string;
  message_id: string | null;
  step_number: number;
  job_kind: "full_draft" | "voice_script";
  attempt_count: number;
  max_attempts: number;
  lock_token: string;
};

type ProcessResult = {
  jobId: string;
  prospectId: string;
  status: "completed" | "queued" | "failed";
  error: string | null;
};

function retryableStatus(status: number): boolean {
  return status === 401 || status === 408 || status === 429 || status >= 500;
}

function cleanError(value: unknown): string {
  const message = String(value || "Research did not return a confirmed draft")
    .replace(/\s+/g, " ")
    .trim();
  return message.slice(0, 900);
}

async function updateClaimedJob(
  job: ResearchJob,
  patch: Record<string, unknown>
) {
  const { data, error } = await supabaseService
    .from("outreach_research_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("workspace_id", job.workspace_id)
    .eq("owner_id", job.owner_id)
    .eq("id", job.id)
    .eq("status", "running")
    .eq("lock_token", job.lock_token)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    throw new Error("The research lease changed before completion was saved");
  }
}

async function runJob(
  job: ResearchJob,
  account: AccountScope,
  origin: string,
  authCookie?: string
): Promise<ProcessResult> {
  let response: Response;
  try {
    if (authCookie) {
      const path =
        job.job_kind === "voice_script"
          ? `/api/crm/outreach/messages/${job.message_id || "missing"}/voice-script`
          : `/api/crm/outreach/${job.prospect_id}/prepare`;
      response = await fetch(new URL(path, origin), {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookie,
        },
        body:
          job.job_kind === "full_draft"
            ? JSON.stringify({ generationMode: "manual" })
            : "{}",
      });
    } else {
      response = await runWithServiceRecordScope(account, () => {
        if (job.job_kind === "voice_script") {
          if (!job.message_id) {
            return new Response(
              JSON.stringify({
                error: "The draft needed for this voice script is missing",
              }),
              {
                status: 409,
                headers: { "Content-Type": "application/json" },
              }
            );
          }
          return createOutreachVoiceScript(
            new NextRequest(
              new URL(
                `/api/crm/outreach/messages/${job.message_id}/voice-script`,
                origin
              ),
              { method: "POST", body: "{}" }
            ),
            { params: { id: job.message_id } }
          );
        }
        return prepareOutreach(
          new NextRequest(
            new URL(`/api/crm/outreach/${job.prospect_id}/prepare`, origin),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ generationMode: "manual" }),
            }
          ),
          { params: { id: job.prospect_id } }
        );
      });
    }
  } catch (error: any) {
    response = new Response(
      JSON.stringify({ error: cleanError(error?.message || error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const body = await response.json().catch(() => ({}));
  const messageId = String(body?.message?.id || "").trim();
  const outputConfirmed =
    job.job_kind === "voice_script"
      ? Boolean(
          messageId &&
            body?.message?.voice_script &&
            body?.message?.voice_status === "script_ready" &&
            body?.audioGenerated === false &&
            body?.emailPreserved === true
        )
      : Boolean(messageId);
  if (response.ok && outputConfirmed) {
    await updateClaimedJob(job, {
      status: "completed",
      result_message_id: messageId,
      completed_at: new Date().toISOString(),
      lease_expires_at: null,
      lock_token: null,
      last_error: null,
      last_http_status: response.status,
    });
    return {
      jobId: job.id,
      prospectId: job.prospect_id,
      status: "completed",
      error: null,
    };
  }

  const error = cleanError(
    body?.error ||
      (job.job_kind === "voice_script"
        ? "LiveCoach did not confirm a safe text only voice script"
        : null)
  );
  const canRetry =
    retryableStatus(response.status) && job.attempt_count < job.max_attempts;
  if (canRetry) {
    const delaySeconds = Math.min(90, 15 * Math.max(1, job.attempt_count));
    await updateClaimedJob(job, {
      status: "queued",
      available_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      lease_expires_at: null,
      lock_token: null,
      last_error: `${error}. LiveCoach will retry automatically.`,
      last_http_status: response.status,
    });
    return {
      jobId: job.id,
      prospectId: job.prospect_id,
      status: "queued",
      error,
    };
  }

  const finalError = `${error}. Fix this blocker, then press Research again.`;
  await updateClaimedJob(job, {
    status: "failed",
    completed_at: new Date().toISOString(),
    lease_expires_at: null,
    lock_token: null,
    last_error: finalError,
    last_http_status: response.status,
  });
  return {
    jobId: job.id,
    prospectId: job.prospect_id,
    status: "failed",
    error: finalError,
  };
}

async function claimJobs(
  account: AccountScope,
  lockToken: string
): Promise<ResearchJob[]> {
  const { data, error } = await supabaseService.rpc(
    "claim_outreach_research_jobs",
    {
      p_workspace_id: account.workspaceId,
      p_owner_id: account.userId,
      p_lock_token: lockToken,
      p_limit: ACCOUNT_CONCURRENCY,
    }
  );
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as ResearchJob[];
}

export async function processOutreachResearchJobs(input: {
  account: AccountScope;
  origin: string;
  authCookie?: string;
  budgetMs?: number;
}) {
  const startedAt = Date.now();
  const budgetMs = Math.min(
    DEFAULT_WORK_BUDGET_MS,
    Math.max(10_000, input.budgetMs || DEFAULT_WORK_BUDGET_MS)
  );
  const results: ProcessResult[] = [];

  while (
    results.length < MAX_JOBS_PER_INVOCATION &&
    Date.now() - startedAt < budgetMs
  ) {
    const lockToken = randomUUID();
    const jobs = await claimJobs(input.account, lockToken);
    if (!jobs.length) break;
    const completed = await Promise.all(
      jobs.map((job) =>
        runJob(job, input.account, input.origin, input.authCookie)
      )
    );
    results.push(...completed);
  }

  return {
    userId: input.account.userId,
    attempted: results.length,
    completed: results.filter((result) => result.status === "completed").length,
    retrying: results.filter((result) => result.status === "queued").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
    elapsedMs: Date.now() - startedAt,
  };
}
