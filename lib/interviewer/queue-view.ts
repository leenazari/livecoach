import "server-only";

import { estimateInterviewerWait, type WaitEstimate } from "@/lib/interviewer/wait-estimate";
import {
  campaignOf,
  interviewerRpc,
  isUuid,
  loadOpenInvite,
  raiseInterviewerError,
  recentConnectedSeconds,
  slotLimit,
} from "@/lib/interviewer/data";
import { supabaseService } from "@/lib/supabase";

export type InterviewerQueueState = {
  ok?: boolean;
  error?: string;
  state?: string;
  sessionId?: string;
  slotId?: string | null;
  queueStatus?: string;
  position?: number;
  priority?: boolean;
  offeredAt?: string | null;
  offerExpiresAt?: string | null;
};

export async function presentQueue(state: InterviewerQueueState, campaignId: string) {
  const [samples, limit] = await Promise.all([
    recentConnectedSeconds(campaignId),
    slotLimit(),
  ]);
  const wait: WaitEstimate = estimateInterviewerWait({
    position: Number(state.position || 1),
    slotLimit: limit,
    recentSeconds: samples,
  });
  return {
    state: state.state || "queued",
    sessionId: state.sessionId || null,
    position: Number(state.position || 0),
    priority: state.priority === true,
    offerExpiresAt: state.offerExpiresAt || null,
    waitLabel: wait.label,
    overTenMinutes: wait.overTenMinutes,
    slotId: state.slotId || null,
  };
}

export async function claimForToken(token: string, sessionId: string | null) {
  const invite = await loadOpenInvite(token);
  if (!invite) return { invite: null, state: null as InterviewerQueueState | null };
  const state = await interviewerRpc<InterviewerQueueState>("claim_interviewer_slot", {
    p_token: token,
    p_session_id: sessionId && isUuid(sessionId) ? sessionId : null,
  });
  return { invite, state };
}

export async function queueStatusForToken(token: string, sessionId: string) {
  const invite = await loadOpenInvite(token);
  if (!invite || !isUuid(sessionId)) return { invite: null, state: null as InterviewerQueueState | null };
  const state = await interviewerRpc<InterviewerQueueState>("interviewer_queue_status", {
    p_token: token,
    p_session_id: sessionId,
  });
  return { invite, state };
}

export async function linkedSession(token: string, sessionId: string) {
  const invite = await loadOpenInvite(token);
  if (!invite || !isUuid(sessionId)) return null;
  const { data, error } = await supabaseService
    .from("interviewer_sessions")
    .select("id, invite_id, workspace_id, campaign_id, status, connected_at, ended_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) raiseInterviewerError(error);
  if (!data || data.invite_id !== invite.id) return null;
  const slot = await supabaseService
    .from("interviewer_slots")
    .select("id, status")
    .eq("session_id", sessionId)
    .eq("status", "active")
    .maybeSingle();
  if (slot.error) raiseInterviewerError(slot.error);
  return { invite, session: data, slot: slot.data, campaign: campaignOf(invite) };
}
