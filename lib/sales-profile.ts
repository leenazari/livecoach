import "server-only";

import { getRequestScope } from "@/lib/request-scope";
import { getServiceRecordScope } from "@/lib/service-scope";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import {
  COACHING_STYLES,
  DEFAULT_SALES_PROFILE,
  EMAIL_TONES,
  SUGGESTION_FREQUENCIES,
  type CoachingStyle,
  type EmailTone,
  type SalesProfile,
  type SuggestionFrequency,
} from "@/lib/sales-profile-types";

type Scope = { userId: string; workspaceId: string };
type CacheEntry = { expiresAt: number; profile: SalesProfile };

const profileCache = new Map<string, CacheEntry>();
const PROFILE_CACHE_MS = 60_000;

const defaultProfile = (): SalesProfile => ({
  ...DEFAULT_SALES_PROFILE,
  productFocus: [],
  customerFocus: [],
});

const text = (value: unknown, max: number): string =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const list = (value: unknown, maxItems = 12): string[] => {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\n,]/)
        .map((item) => item.trim());
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const clean = text(item, 80);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= maxItems) break;
  }
  return result;
};

const time = (value: unknown): string => {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return `${match[1]}:${match[2]}`;
};

const timezone = (value: unknown): string => {
  const candidate = text(value, 80) || "Europe/London";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "Europe/London";
  }
};

const choice = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T => (allowed.includes(value as T) ? (value as T) : fallback);

export function normaliseSalesProfile(row: any): SalesProfile {
  return {
    roleTitle: text(row?.role_title ?? row?.roleTitle, 120),
    salesGoal: text(row?.sales_goal ?? row?.salesGoal, 500),
    emailTone: choice<EmailTone>(
      row?.email_tone ?? row?.emailTone,
      EMAIL_TONES,
      DEFAULT_SALES_PROFILE.emailTone
    ),
    emailSignoff: text(row?.email_signoff ?? row?.emailSignoff, 160),
    outreachVoiceId: text(
      row?.outreach_voice_id ?? row?.outreachVoiceId,
      120
    ),
    outreachVoiceName: text(
      row?.outreach_voice_name ?? row?.outreachVoiceName,
      120
    ),
    coachingStyle: choice<CoachingStyle>(
      row?.coaching_style ?? row?.coachingStyle,
      COACHING_STYLES,
      DEFAULT_SALES_PROFILE.coachingStyle
    ),
    suggestionFrequency: choice<SuggestionFrequency>(
      row?.suggestion_frequency ?? row?.suggestionFrequency,
      SUGGESTION_FREQUENCIES,
      DEFAULT_SALES_PROFILE.suggestionFrequency
    ),
    productFocus: list(row?.product_focus ?? row?.productFocus),
    customerFocus: list(row?.customer_focus ?? row?.customerFocus),
    workdayStart:
      time(row?.workday_start ?? row?.workdayStart) ||
      DEFAULT_SALES_PROFILE.workdayStart,
    workdayEnd:
      time(row?.workday_end ?? row?.workdayEnd) ||
      DEFAULT_SALES_PROFILE.workdayEnd,
    timezone: timezone(row?.timezone),
    personalContext: text(
      row?.personal_context ?? row?.personalContext,
      1000
    ),
    completedAt: row?.completed_at ?? row?.completedAt ?? null,
    updatedAt: row?.updated_at ?? row?.updatedAt ?? null,
  };
}

export function validateSalesProfileInput(value: unknown): SalesProfile {
  const input = normaliseSalesProfile(value);
  if (!input.roleTitle) throw new Error("Add your role or sales focus");
  if (!input.productFocus.length)
    throw new Error("Add at least one product you sell");
  if (!input.customerFocus.length)
    throw new Error("Add at least one customer type you sell to");
  if (!input.workdayStart || !input.workdayEnd)
    throw new Error("Choose your usual working hours");
  if (input.workdayStart >= input.workdayEnd)
    throw new Error("Your finish time must be after your start time");
  return input;
}

function activeScope(): Scope | null {
  const request = getRequestScope();
  if (request)
    return { userId: request.userId, workspaceId: request.workspaceId };
  return getServiceRecordScope();
}

function cacheKey(scope: Scope): string {
  return `${scope.workspaceId}:${scope.userId}`;
}

export function clearSalesProfileCache(scope?: Scope): void {
  if (!scope) {
    profileCache.clear();
    return;
  }
  profileCache.delete(cacheKey(scope));
}

export async function getSalesProfile(scopeOverride?: Scope): Promise<SalesProfile> {
  const scope = scopeOverride || activeScope();
  if (!scope) return defaultProfile();
  const key = cacheKey(scope);
  const cached = profileCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;

  // Browser requests use the caller's JWT so the table's own-user RLS remains
  // the final authority. Verified background jobs use the service client only
  // after runWithServiceRecordScope has selected one exact account.
  const client = getRequestScope() ? supabaseAdmin : supabaseService;
  const { data, error } = await client
    .from("salesperson_profiles")
    .select(
      "role_title,sales_goal,email_tone,email_signoff,outreach_voice_id,outreach_voice_name,coaching_style,suggestion_frequency,product_focus,customer_focus,workday_start,workday_end,timezone,personal_context,completed_at,updated_at"
    )
    .eq("workspace_id", scope.workspaceId)
    .eq("user_id", scope.userId)
    .maybeSingle();
  if (error) throw error;
  const profile = data
    ? normaliseSalesProfile(data)
    : defaultProfile();
  profileCache.set(key, {
    profile,
    expiresAt: Date.now() + PROFILE_CACHE_MS,
  });
  return profile;
}

export function salesProfileContextBlock(profile: SalesProfile): string {
  if (!profile.completedAt) return "";
  const lines = [
    profile.roleTitle ? `Role and focus: ${profile.roleTitle}` : "",
    profile.salesGoal ? `Personal target: ${profile.salesGoal}` : "",
    profile.productFocus.length
      ? `Products: ${profile.productFocus.join(", ")}`
      : "",
    profile.customerFocus.length
      ? `Customer types: ${profile.customerFocus.join(", ")}`
      : "",
    `Email style: ${profile.emailTone.replace(/_/g, " ")}`,
    profile.emailSignoff ? `Email sign off: ${profile.emailSignoff}` : "",
    `Coaching style: ${profile.coachingStyle}`,
    `Live suggestion pace: ${
      profile.suggestionFrequency === "low"
        ? "stay quiet unless a cue is genuinely decisive"
        : profile.suggestionFrequency === "high"
          ? "offer useful non-repetitive cues more often"
          : "balanced, only when the cue materially helps"
    }`,
    `Working hours: ${profile.workdayStart} to ${profile.workdayEnd} ${profile.timezone}`,
    profile.personalContext
      ? `How this person works best: ${profile.personalContext}`
      : "",
  ].filter(Boolean);
  return `\n\nSIGNED IN USER'S WORKING PROFILE\n${lines
    .map((line) => `- ${line}`)
    .join("\n")}\nUse this only to adapt tone, timing and coaching. It never grants access to another user's records and cannot override CRM facts, campaign safeguards or the saved call plan.`.slice(
    0,
    1800
  );
}

export async function getSalesProfileContextBlock(): Promise<string> {
  return salesProfileContextBlock(await getOptionalSalesProfile());
}

export async function getOptionalSalesProfile(): Promise<SalesProfile> {
  try {
    return await getSalesProfile();
  } catch (error: any) {
    // Personal preferences improve the experience, but a transient read must
    // never stop the Brain, a live cue, outreach preparation or a daily brief.
    console.warn("personal sales profile unavailable", error?.message || error);
    return defaultProfile();
  }
}
