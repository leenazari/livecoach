import { NextRequest, NextResponse } from "next/server";
import { POST as buildQueue } from "@/app/api/crm/outreach/queue/route";
import { POST as prepareOutreach } from "@/app/api/crm/outreach/[id]/prepare/route";
import { POST as createOutreachVoiceScript } from "@/app/api/crm/outreach/messages/[id]/voice-script/route";
import { listActiveAccountScopes } from "@/lib/automation-accounts";
import { runWithServiceRecordScope } from "@/lib/service-scope";
import { supabaseAdmin } from "@/lib/supabase";
import {
  needsNewOvernightOutreachResearch,
  needsOnlyOvernightVoiceScript,
  OVERNIGHT_RESEARCH_INVENTORY_LIMIT,
  roundRobinPreparationJobs,
  selectOvernightOutreachPreparation,
} from "@/lib/outreach-overnight-preparation";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_PER_ACCOUNT = 8;
const MAX_PER_RUN = 30;
const PREPARATION_CONCURRENCY = 6;
const WORK_BUDGET_MS = 275_000;

type AccountScope = { userId: string; workspaceId: string };
type QueueBuild = {
  account: AccountScope;
  status: number;
  body: any;
  candidates: any[];
  eligible: number;
  outstandingResearch: number;
  researchSlotsAvailable: number;
  newResearchPlanned: number;
  deferredByResearchCap: number;
  skipReason: string | null;
};
type PreparationJob = {
  account: AccountScope;
  row: any;
  needsNewResearch: boolean;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await work(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function buildAccountQueue(req: NextRequest, account: AccountScope) {
  const response = await runWithServiceRecordScope(account, () =>
    buildQueue(
      new NextRequest(new URL("/api/crm/outreach/queue", req.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    )
  );
  const body = await response.json().catch(() => ({}));
  const skipReason = /activate and select a campaign first/i.test(
    String(body?.error || "")
  )
    ? "no active campaign"
    : null;
  const { count: outstandingResearch, error: researchCountError } =
    await supabaseAdmin
      .from("outreach_enrolments")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .eq("current_step", 1)
      .is("last_sent_at", null)
      .not("researched_at", "is", null)
      .in("status", ["paused", "queued", "researched", "drafted", "approved"]);
  if (researchCountError) throw researchCountError;
  const selection = selectOvernightOutreachPreparation(
    Array.isArray(body?.queue) ? body.queue : [],
    {
      outstandingResearch: outstandingResearch || 0,
      maxAttempts: MAX_PER_ACCOUNT,
    }
  );
  return {
    account,
    status: response.status,
    body,
    candidates: selection.candidates,
    eligible: selection.eligible,
    outstandingResearch: selection.outstandingResearch,
    researchSlotsAvailable: selection.researchSlotsAvailable,
    newResearchPlanned: selection.newResearchPlanned,
    deferredByResearchCap: selection.deferredByResearchCap,
    skipReason,
  } as QueueBuild;
}

async function prepareJob(req: NextRequest, job: PreparationJob) {
  const prospectId = String(job.row?.prospect?.id || "").trim();
  if (!prospectId) {
    return {
      prospectId: null,
      ok: false,
      status: 400,
      researchMode: job.needsNewResearch ? "new" : "existing",
      error: "missing prospect",
    };
  }
  const messageId = String(job.row?.message?.id || "").trim();
  const needsOnlyVoiceScript = needsOnlyOvernightVoiceScript(job.row);
  const response = await runWithServiceRecordScope(job.account, () =>
    needsOnlyVoiceScript
      ? createOutreachVoiceScript(
          new NextRequest(
            new URL(
              `/api/crm/outreach/messages/${messageId}/voice-script`,
              req.url
            ),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            }
          ),
          { params: { id: messageId } }
        )
      : prepareOutreach(
          new NextRequest(
            new URL(`/api/crm/outreach/${prospectId}/prepare`, req.url),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ generationMode: "overnight" }),
            }
          ),
          { params: { id: prospectId } }
        )
  );
  const body = await response.json().catch(() => ({}));
  const ok = response.ok && Boolean(body?.message?.id);
  return {
    prospectId,
    ok,
    status: response.status,
    messageId: body?.message?.id || messageId || null,
    preparationType: needsOnlyVoiceScript ? "voice_script" : "full_draft",
    researchMode: job.needsNewResearch ? "new" : "existing",
    error: ok ? null : body?.error || "preparation did not return a draft",
  };
}

// Builds each salesperson's protected queue, then prepares only incomplete
// email drafts and text voice scripts. It never approves, sends or creates paid
// audio. Existing research and incomplete scripts are recovered first. New
// research stops when that salesperson already has 20 unused researched leads,
// even though three early-morning passes make transient failures retryable.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "not authorised" }, { status: 401 });
  const startedAt = Date.now();
  try {
    const accounts = await listActiveAccountScopes({ connectedOnly: true });
    const builds = await Promise.all(
      accounts.map((account) => buildAccountQueue(req, account))
    );
    const groupedJobs = builds.map((build) =>
      build.candidates.map((row) => ({
        account: build.account,
        row,
        needsNewResearch: needsNewOvernightOutreachResearch(row),
      }))
    );
    const jobs = roundRobinPreparationJobs(groupedJobs, MAX_PER_RUN);
    const prepared = await mapWithConcurrency(
      jobs,
      PREPARATION_CONCURRENCY,
      async (job) => {
        if (Date.now() - startedAt >= WORK_BUDGET_MS) {
          return {
            prospectId: job.row?.prospect?.id || null,
            ok: false,
            status: 503,
            messageId: null,
            researchMode: job.needsNewResearch ? "new" : "existing",
            error: "deferred to the next morning pass",
          };
        }
        return prepareJob(req, job);
      }
    );
    const byUser = new Map<string, typeof prepared>();
    for (let index = 0; index < jobs.length; index += 1) {
      const rows = byUser.get(jobs[index].account.userId) || [];
      rows.push(prepared[index]);
      byUser.set(jobs[index].account.userId, rows);
    }
    const results = builds.map((build) => {
      const rows = byUser.get(build.account.userId) || [];
      return {
        userId: build.account.userId,
        status: build.status,
        queueDate: build.body?.date || null,
        queueSize: Array.isArray(build.body?.queue) ? build.body.queue.length : 0,
        queueAdded: Number(build.body?.added || 0),
        eligible: build.eligible,
        attempted: rows.length,
        prepared: rows.filter((row) => row.ok).length,
        newResearchPrepared: rows.filter(
          (row) => row.ok && row.researchMode === "new"
        ).length,
        failed: rows.filter((row) => !row.ok).length,
        skipped: build.skipReason,
        researchInventory: build.outstandingResearch,
        researchInventoryLimit: OVERNIGHT_RESEARCH_INVENTORY_LIMIT,
        researchSlotsAvailable: build.researchSlotsAvailable,
        newResearchPlanned: build.newResearchPlanned,
        deferredByResearchCap: build.deferredByResearchCap,
        remaining: Math.max(
          0,
          build.eligible - rows.filter((row) => row.ok).length
        ),
        errors: rows
          .filter((row) => !row.ok)
          .map((row) => ({ prospectId: row.prospectId, error: row.error })),
        queueError:
          !build.skipReason &&
          (build.status >= 400 || !Array.isArray(build.body?.queue))
            ? build.body?.error || "queue build failed"
            : null,
      };
    });
    const ok =
      results.every((result) => !result.queueError) &&
      prepared.every((row) => row.ok);
    console.log(
      JSON.stringify({
        level: ok ? "info" : "warning",
        msg: "overnight outreach preparation completed",
        accounts: results.length,
        prepared: prepared.filter((row) => row.ok).length,
        newResearchPrepared: prepared.filter(
          (row) => row.ok && row.researchMode === "new"
        ).length,
        researchInventoryLimit: OVERNIGHT_RESEARCH_INVENTORY_LIMIT,
        deferredByResearchCap: results.reduce(
          (total, result) => total + result.deferredByResearchCap,
          0
        ),
        failed: prepared.filter((row) => !row.ok).length,
        ms: Date.now() - startedAt,
      })
    );
    return NextResponse.json({
      ok,
      mode: "overnight",
      prepared: prepared.filter((row) => row.ok).length,
      newResearchPrepared: prepared.filter(
        (row) => row.ok && row.researchMode === "new"
      ).length,
      researchInventoryLimit: OVERNIGHT_RESEARCH_INVENTORY_LIMIT,
      deferredByResearchCap: results.reduce(
        (total, result) => total + result.deferredByResearchCap,
        0
      ),
      failed: prepared.filter((row) => !row.ok).length,
      accounts: results,
      ms: Date.now() - startedAt,
    });
  } catch (error: any) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "overnight outreach preparation failed",
        error: error?.message || "unknown error",
        ms: Date.now() - startedAt,
      })
    );
    return NextResponse.json({ error: error?.message || "failed to build daily outreach queue" }, { status: 500 });
  }
}
