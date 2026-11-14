import "server-only";

import { supabaseService } from "@/lib/supabase";

export class InterviewerDataError extends Error {
  constructor(
    message: string,
    readonly code: "unavailable" | "not_ready"
  ) {
    super(message);
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function raiseInterviewerError(error: { message?: string; code?: string } | null): void {
  if (!error) return;
  const text = `${error.code || ""} ${error.message || ""}`;
  if (/42883|PGRST202|PGRST205|does not exist|schema cache|could not find the (table|function)/i.test(text)) {
    throw new InterviewerDataError("The interviewer database is not ready.", "not_ready");
  }
  console.error("interviewer data request failed", { code: error.code || "unknown" });
  throw new InterviewerDataError("The interviewer request could not be completed.", "unavailable");
}

export async function interviewerRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseService.rpc(name, args);
  raiseInterviewerError(error);
  return data as T;
}

export type InterviewerCampaignRow = {
  id: string;
  name: string;
  owner_id: string;
  workspace_id: string;
  persona_override: string | null;
  prompt_override: string | null;
  voice_id: string;
  max_minutes: number | null;
  rate_per_minute: number | string;
  currency: string;
  margin_percent: number | string;
  billing_granularity: "second" | "minute";
};

export type InterviewerInviteRow = {
  id: string;
  workspace_id: string;
  campaign_id: string;
  token: string;
  prospect_name: string | null;
  prospect_email: string | null;
  expires_at: string;
  revoked_at: string | null;
  campaign: InterviewerCampaignRow | InterviewerCampaignRow[] | null;
};

export function campaignOf(invite: InterviewerInviteRow): InterviewerCampaignRow | null {
  const campaign = invite.campaign;
  if (!campaign) return null;
  return Array.isArray(campaign) ? campaign[0] || null : campaign;
}

export async function loadOpenInvite(token: string): Promise<InterviewerInviteRow | null> {
  if (!isUuid(token)) return null;
  const { data, error } = await supabaseService
    .from("interviewer_invites")
    .select(
      "id, workspace_id, campaign_id, token, prospect_name, prospect_email, expires_at, revoked_at, campaign:interviewer_campaigns(id, name, owner_id, workspace_id, persona_override, prompt_override, voice_id, max_minutes, rate_per_minute, currency, margin_percent, billing_granularity)"
    )
    .eq("token", token)
    .maybeSingle();
  raiseInterviewerError(error);
  const invite = data as InterviewerInviteRow | null;
  if (!invite || invite.revoked_at) return null;
  if (new Date(invite.expires_at).getTime() <= Date.now()) return null;
  if (!campaignOf(invite)) return null;
  return invite;
}

export async function loadCampaignDocuments(campaignId: string) {
  const { data, error } = await supabaseService
    .from("interviewer_documents")
    .select("title, body")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true })
    .limit(8);
  raiseInterviewerError(error);
  return (data || []) as Array<{ title: string; body: string }>;
}

export async function recentConnectedSeconds(campaignId: string): Promise<number[]> {
  const { data, error } = await supabaseService
    .from("interviewer_sessions")
    .select("billable_seconds, campaign_id")
    .eq("status", "ended")
    .not("billable_seconds", "is", null)
    .order("ended_at", { ascending: false })
    .limit(40);
  raiseInterviewerError(error);
  const rows = (data || []) as Array<{ billable_seconds: number | null; campaign_id: string }>;
  const own = rows.filter((row) => row.campaign_id === campaignId && row.billable_seconds);
  const chosen = own.length >= 3 ? own : rows;
  return chosen
    .map((row) => Number(row.billable_seconds))
    .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
}

export async function slotLimit(): Promise<number> {
  const { data, error } = await supabaseService
    .from("interviewer_config")
    .select("max_concurrent_slots")
    .eq("id", 1)
    .maybeSingle();
  raiseInterviewerError(error);
  const limit = Number(data?.max_concurrent_slots);
  return Number.isFinite(limit) && limit > 0 ? limit : 43;
}
