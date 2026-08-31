import "server-only";

import { NextRequest } from "next/server";
import { POST as buildCallSummary } from "@/app/api/interview/summary/route";
import { resolveRecordScope } from "@/lib/record-scope";
import { supabaseAdmin } from "@/lib/supabase";

export type CallSummaryPayload = {
  transcript: string;
  knowledgeContext?: string | null;
  role?: string | null;
  candidate?: string | null;
  competencies?: string[];
  callType?: string | null;
  sessionId: string;
  companyId?: string | null;
  workstreamId?: string | null;
  upcomingId?: string | null;
  favouriteCues?: Array<{ text: string; why?: string }>;
  cost?: number | null;
  source?: string | null;
  userNotes?: string | null;
  manualRecap?: boolean;
};

export type CallSummaryJobResult = {
  landed: boolean;
  inProgress: boolean;
  alreadyDone: boolean;
  summary: any | null;
  error: string | null;
};

const CLAIM_TTL_MS = 90_000;

export function summaryClaimIsFresh(
  lastTry: string | null | undefined,
  now = Date.now()
) {
  if (!lastTry) return false;
  const value = new Date(lastTry).getTime();
  return Number.isFinite(value) && now - value < CLAIM_TTL_MS;
}

const safeFailure = (value: unknown) => {
  const message = String(value || "").toLowerCase();
  if (/\b429\b|rate limit/.test(message))
    return "the AI service is busy, automatic retry scheduled";
  if (/\b5\d\d\b|temporar|unavailable|timeout|timed out|abort/.test(message))
    return "the AI service was temporarily unavailable, automatic retry scheduled";
  return "the summary did not complete, automatic retry scheduled";
};

export async function runCallSummaryJob(
  req: Request,
  payload: CallSummaryPayload,
  options?: { force?: boolean }
): Promise<CallSummaryJobResult> {
  const sessionId = String(payload.sessionId || "").trim();
  if (!sessionId || !String(payload.transcript || "").trim()) {
    return {
      landed: false,
      inProgress: false,
      alreadyDone: false,
      summary: null,
      error: "the captured call is missing its session or transcript",
    };
  }

  const accountScope = await resolveRecordScope();

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("interview_summaries")
    .select("summary")
    .eq("workspace_id", accountScope.workspaceId)
    .eq("owner_id", accountScope.userId)
    .eq("session_id", sessionId)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.summary) {
    await supabaseAdmin
      .from("interview_sessions")
      .update({ summary_error: null })
      .eq("workspace_id", accountScope.workspaceId)
      .eq("owner_id", accountScope.userId)
      .eq("session_id", sessionId);
    return {
      landed: true,
      inProgress: false,
      alreadyDone: true,
      summary: existing.summary,
      error: null,
    };
  }

  const { data: session, error: sessionError } = await supabaseAdmin
    .from("interview_sessions")
    .select("session_id,summary_attempts,summary_last_try")
    .eq("workspace_id", accountScope.workspaceId)
    .eq("owner_id", accountScope.userId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) {
    return {
      landed: false,
      inProgress: false,
      alreadyDone: false,
      summary: null,
      error: "captured call not found",
    };
  }

  const previousAttempts = session.summary_attempts;
  const attempts = Number(previousAttempts || 0);
  const previousTry = session.summary_last_try || null;
  if (!options?.force && summaryClaimIsFresh(previousTry)) {
    return {
      landed: false,
      inProgress: true,
      alreadyDone: false,
      summary: null,
      error: null,
    };
  }

  const claimedAt = new Date().toISOString();
  let claim = supabaseAdmin
    .from("interview_sessions")
    .update({
      summary_attempts: attempts + 1,
      summary_last_try: claimedAt,
      summary_error: null,
    })
    .eq("workspace_id", accountScope.workspaceId)
    .eq("owner_id", accountScope.userId)
    .eq("session_id", sessionId);
  claim =
    previousAttempts === null || previousAttempts === undefined
      ? claim.is("summary_attempts", null)
      : claim.eq("summary_attempts", attempts);
  claim = previousTry
    ? claim.eq("summary_last_try", previousTry)
    : claim.is("summary_last_try", null);
  const { data: claimed, error: claimError } = await claim
    .select("session_id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    return {
      landed: false,
      inProgress: true,
      alreadyDone: false,
      summary: null,
      error: null,
    };
  }

  let responseData: any = null;
  let failure = "";
  try {
    const headers = new Headers({ "Content-Type": "application/json" });
    const cookie = req.headers.get("cookie");
    const authorization = req.headers.get("authorization");
    if (cookie) headers.set("cookie", cookie);
    if (authorization) headers.set("authorization", authorization);
    const summaryRequest = new NextRequest(
      new URL("/api/interview/summary", req.url),
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      }
    );
    const response = await buildCallSummary(summaryRequest);
    responseData = await response.json().catch(() => ({}));
    if (!response.ok) failure = responseData?.error || `summariser returned ${response.status}`;
  } catch (error: any) {
    failure = error?.message || "the summariser did not respond";
  }

  const { data: saved, error: savedError } = await supabaseAdmin
    .from("interview_summaries")
    .select("summary")
    .eq("workspace_id", accountScope.workspaceId)
    .eq("owner_id", accountScope.userId)
    .eq("session_id", sessionId)
    .limit(1)
    .maybeSingle();
  if (savedError) throw savedError;
  const landed = !!saved?.summary;
  const error = landed ? null : safeFailure(failure);
  const { error: stateError } = await supabaseAdmin
    .from("interview_sessions")
    .update({ summary_error: error })
    .eq("workspace_id", accountScope.workspaceId)
    .eq("owner_id", accountScope.userId)
    .eq("session_id", sessionId);
  if (stateError) throw stateError;

  return {
    landed,
    inProgress: false,
    alreadyDone: false,
    summary: landed ? saved?.summary || responseData?.summary || null : null,
    error,
  };
}
