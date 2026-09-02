import "server-only";

import { randomUUID } from "node:crypto";

import { BRAIN_WIDGETS } from "@/lib/brain-control-shared";
import type { RequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export type BrainScope = Pick<
  RequestScope,
  "userId" | "workspaceId" | "role" | "status"
>;

export type BrainActionKind =
  | "read_and_analyse"
  | "create_internal_draft"
  | "update_internal_crm"
  | "customer_communication"
  | "paid_generation"
  | "destructive_action"
  | "shared_learning";

export type BrainTrustMode = "auto" | "approval_required" | "blocked";

const MAX_TEXT = 2_000;
const ALLOWED_WIDGETS = new Set<string>(BRAIN_WIDGETS);
const MANAGER_ROLES = new Set(["owner", "manager"]);
const HARD_LOCKED_ACTIONS = new Set<BrainActionKind>([
  "customer_communication",
  "paid_generation",
  "destructive_action",
  "shared_learning",
]);

const clean = (value: unknown, maximum = MAX_TEXT) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);

const slugify = (value: unknown) =>
  clean(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const finiteMoney = (value: unknown, maximum = 1_000) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(maximum, Number(number.toFixed(6))));
};

const arrayValue = <T = any>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const londonParts = (date: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;

const londonWallTimeToUtc = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
) => {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;
  for (let pass = 0; pass < 3; pass += 1) {
    const shown = londonParts(new Date(guess));
    const shownUtc = Date.UTC(
      Number(shown.year),
      Number(shown.month) - 1,
      Number(shown.day),
      Number(shown.hour),
      Number(shown.minute),
      Number(shown.second)
    );
    guess += target - shownUtc;
  }
  return new Date(guess);
};

export function nextRoutineRunAt(input: {
  scheduleMode: "manual" | "daily" | "weekdays";
  scheduledLocalTime: string;
  from?: Date;
}) {
  if (input.scheduleMode === "manual") return null;
  const from = input.from || new Date();
  const parts = londonParts(from);
  const [hourValue, minuteValue] = input.scheduledLocalTime
    .split(":")
    .map(Number);
  const hour = Number.isInteger(hourValue) ? Math.max(0, Math.min(23, hourValue)) : 7;
  const minute = Number.isInteger(minuteValue)
    ? Math.max(0, Math.min(59, minuteValue))
    : 30;
  let candidate = londonWallTimeToUtc(
    Number(parts.year),
    Number(parts.month),
    Number(parts.day),
    hour,
    minute
  );
  if (candidate.getTime() <= from.getTime() + 30_000) {
    const dayAfter = new Date(
      Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1)
    );
    candidate = londonWallTimeToUtc(
      dayAfter.getUTCFullYear(),
      dayAfter.getUTCMonth() + 1,
      dayAfter.getUTCDate(),
      hour,
      minute
    );
  }
  if (input.scheduleMode === "weekdays") {
    while (["Sat", "Sun"].includes(londonParts(candidate).weekday)) {
      const shown = londonParts(candidate);
      const following = new Date(
        Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day) + 1)
      );
      candidate = londonWallTimeToUtc(
        following.getUTCFullYear(),
        following.getUTCMonth() + 1,
        following.getUTCDate(),
        hour,
        minute
      );
    }
  }
  return candidate.toISOString();
}

const TRUST_DEFAULTS: Array<{
  actionKind: BrainActionKind;
  mode: BrainTrustMode;
  hardLocked: boolean;
  reason: string;
}> = [
  {
    actionKind: "read_and_analyse",
    mode: "auto",
    hardLocked: false,
    reason: "Brain may read records that this signed-in user is already allowed to see.",
  },
  {
    actionKind: "create_internal_draft",
    mode: "auto",
    hardLocked: false,
    reason: "Internal drafts are safe to prepare. A person still decides whether they are used.",
  },
  {
    actionKind: "update_internal_crm",
    mode: "approval_required",
    hardLocked: false,
    reason: "Changes to the CRM stay behind a visible confirmation.",
  },
  {
    actionKind: "customer_communication",
    mode: "approval_required",
    hardLocked: true,
    reason: "Email, LinkedIn, voice notes and other customer contact always need a person.",
  },
  {
    actionKind: "paid_generation",
    mode: "approval_required",
    hardLocked: true,
    reason: "Every paid generation starts only from an explicit user request.",
  },
  {
    actionKind: "destructive_action",
    mode: "blocked",
    hardLocked: true,
    reason: "Brain cannot delete or destructively rewrite business records.",
  },
  {
    actionKind: "shared_learning",
    mode: "approval_required",
    hardLocked: true,
    reason: "A learning becomes team-wide only after an owner or manager approves it.",
  },
];

const PLAY_DEFAULTS = [
  {
    slug: "morning-sales-control",
    name: "Morning sales control",
    description: "Build one approval-ready view of the work that matters today.",
    triggerSummary: "Weekday morning or manual run",
    steps: [
      "Review reply drafts awaiting approval",
      "Surface overdue commitments",
      "List calls in the next 48 hours",
      "Flag open deals with no meaningful activity for 14 days",
      "Show researched outreach inventory without creating more research",
    ],
  },
  {
    slug: "positive-reply",
    name: "Positive reply",
    description: "Turn a positive response into a prepared next move without sending it.",
    triggerSummary: "A lead replies with interest",
    steps: [
      "Confirm the exact person and CRM match",
      "Summarise intent and evidence",
      "Prepare a reply and meeting next step",
      "Hold communication for approval",
    ],
  },
  {
    slug: "demo-booked",
    name: "Demo booked",
    description: "Prepare the salesperson for a booked demonstration and protect ownership.",
    triggerSummary: "A calendar booking is linked to a CRM contact",
    steps: [
      "Validate exact contact identity",
      "Show company and relationship context",
      "Prepare call objectives and questions",
      "Keep any external follow-up approval-only",
    ],
  },
  {
    slug: "rescue-stalled-deal",
    name: "Rescue a stalled deal",
    description: "Diagnose an inactive opportunity and prepare a focused recovery plan.",
    triggerSummary: "No meaningful activity for 14 days",
    steps: [
      "Review the last verified activity",
      "Check the current next action and owner",
      "Identify the smallest credible unblock",
      "Prepare actions for human review",
    ],
  },
  {
    slug: "post-call-follow-up",
    name: "Post-call follow-up",
    description: "Convert verified call outcomes into a clean follow-up package.",
    triggerSummary: "A call summary is complete",
    steps: [
      "Confirm commitments and dates from the call",
      "Draft the follow-up email",
      "Prepare CRM changes separately",
      "Require approval before sending or saving changes",
    ],
  },
  {
    slug: "morning-outreach-preparation",
    name: "Morning outreach preparation",
    description: "Use existing researched inventory and keep campaign overlap visible.",
    triggerSummary: "Before the daily outreach block",
    steps: [
      "Count ready researched contacts by salesperson",
      "Show active campaign and recent contact state",
      "Flag reply, suppression and cooldown conflicts",
      "Do not research more than the separate overnight cap",
    ],
  },
] as const;

const DEFAULT_WIDGETS = [
  "reply_drafts",
  "overdue_tasks",
  "upcoming_calls",
  "stalled_opportunities",
  "outreach_inventory",
  "pending_approvals",
  "background_runs",
  "cost_forecast",
];

export async function ensureBrainDefaults(scope: BrainScope) {
  if (scope.status !== "active") throw new Error("Active workspace access is required");
  const [playsResult, trustResult, pagesResult, routinesResult] = await Promise.all([
    supabaseService
      .from("brain_sales_plays")
      .select("id,slug")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId),
    supabaseService
      .from("brain_trust_rules")
      .select("id,action_kind")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId),
    supabaseService
      .from("brain_pages")
      .select("id,slug,is_default")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId),
    supabaseService
      .from("brain_routines")
      .select("id,routine_kind")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .neq("status", "archived"),
  ]);
  for (const result of [playsResult, trustResult, pagesResult, routinesResult]) {
    if (result.error) throw result.error;
  }

  const existingPlaySlugs = new Set((playsResult.data || []).map((row: any) => row.slug));
  const missingPlays = PLAY_DEFAULTS.filter((play) => !existingPlaySlugs.has(play.slug));
  if (missingPlays.length) {
    const { error } = await supabaseService.from("brain_sales_plays").insert(
      missingPlays.map((play) => ({
        workspace_id: scope.workspaceId,
        owner_id: scope.userId,
        visibility: "private",
        slug: play.slug,
        name: play.name,
        description: play.description,
        trigger_summary: play.triggerSummary,
        steps: play.steps,
        approval_policy: {
          customerCommunication: "approval_required",
          crmUpdates: "approval_required",
          paidGeneration: "approval_required",
        },
        version: 1,
        status: "active",
        is_system: true,
        estimated_cost_gbp: 0,
        hard_cost_cap_gbp: 0,
      }))
    );
    if (error && error.code !== "23505") throw error;
  }

  const existingActions = new Set(
    (trustResult.data || []).map((row: any) => row.action_kind)
  );
  const missingTrustRules = TRUST_DEFAULTS.filter(
    (rule) => !existingActions.has(rule.actionKind)
  );
  if (missingTrustRules.length) {
    const { error } = await supabaseService.from("brain_trust_rules").insert(
      missingTrustRules.map((rule) => ({
        workspace_id: scope.workspaceId,
        owner_id: scope.userId,
        visibility: "private",
        action_kind: rule.actionKind,
        mode: rule.mode,
        hard_locked: rule.hardLocked,
        reason: rule.reason,
      }))
    );
    if (error && error.code !== "23505") throw error;
  }

  if (!(pagesResult.data || []).length) {
    const { error } = await supabaseService.from("brain_pages").insert({
      workspace_id: scope.workspaceId,
      owner_id: scope.userId,
      visibility: "private",
      slug: "morning-control",
      title: "Morning control",
      description: "One live page for replies, commitments, calls, stalled deals and ready outreach.",
      widgets: DEFAULT_WIDGETS,
      status: "active",
      is_default: true,
    });
    if (error && error.code !== "23505") throw error;
  }

  if (!(routinesResult.data || []).some((row: any) => row.routine_kind === "morning_sales_control")) {
    const { data: morningPlay, error: playError } = await supabaseService
      .from("brain_sales_plays")
      .select("id")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("slug", "morning-sales-control")
      .eq("version", 1)
      .maybeSingle();
    if (playError) throw playError;
    const { error } = await supabaseService.from("brain_routines").insert({
      workspace_id: scope.workspaceId,
      owner_id: scope.userId,
      visibility: "private",
      play_id: morningPlay?.id || null,
      name: "My morning sales control",
      description: "Prepare my daily priorities without sending, deleting or creating paid media.",
      routine_kind: "morning_sales_control",
      schedule_mode: "weekdays",
      scheduled_local_time: "07:30:00",
      timezone: "Europe/London",
      status: "active",
      approval_mode: "review_required",
      estimated_cost_gbp: 0,
      hard_cost_cap_gbp: 0,
      next_run_at: nextRoutineRunAt({
        scheduleMode: "weekdays",
        scheduledLocalTime: "07:30",
      }),
    });
    if (error) throw error;
  }
}

async function ensureWorkspaceBrainTrustDefaults(scope: BrainScope) {
  if (scope.role !== "owner") return;
  const [{ data: members, error: memberError }, { data: current, error: ruleError }] =
    await Promise.all([
      supabaseService
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", scope.workspaceId)
        .eq("status", "active"),
      supabaseService
        .from("brain_trust_rules")
        .select("owner_id,action_kind")
        .eq("workspace_id", scope.workspaceId),
    ]);
  if (memberError) throw memberError;
  if (ruleError) throw ruleError;
  const existing = new Set(
    (current || []).map((row: any) => `${row.owner_id}:${row.action_kind}`)
  );
  const missing = (members || []).flatMap((member: any) =>
    TRUST_DEFAULTS.filter(
      (rule) => !existing.has(`${member.user_id}:${rule.actionKind}`)
    ).map((rule) => ({
      workspace_id: scope.workspaceId,
      owner_id: member.user_id,
      visibility: "private",
      action_kind: rule.actionKind,
      mode: rule.mode,
      hard_locked: rule.hardLocked,
      reason: rule.reason,
    }))
  );
  if (!missing.length) return;
  const { error } = await supabaseService.from("brain_trust_rules").insert(missing);
  if (error && error.code !== "23505") throw error;
}

function monthlyFrequency(scheduleMode: string) {
  if (scheduleMode === "daily") return 30.44;
  if (scheduleMode === "weekdays") return 21.74;
  return 0;
}

export async function getBrainControlSnapshot(scope: BrainScope) {
  await ensureBrainDefaults(scope);
  await ensureWorkspaceBrainTrustDefaults(scope);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  let executionQuery = supabaseService
    .from("brain_action_executions")
    .select(
      "id,actor_user_id,actor_role,action_type,action_kind,label,status,policy_decision,owner_override_requested,owner_override_applied,attempt_count,estimated_cost_gbp,actual_cost_gbp,recovery,blocker_code,error,created_at,completed_at,undone_at"
    )
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: false })
    .limit(80);
  if (scope.role !== "owner") {
    executionQuery = executionQuery.eq("actor_user_id", scope.userId);
  }
  let actionCostQuery = supabaseService
    .from("brain_action_executions")
    .select("actual_cost_gbp")
    .eq("workspace_id", scope.workspaceId)
    .gte("created_at", monthStart.toISOString())
    .limit(5000);
  if (scope.role !== "owner") {
    actionCostQuery = actionCostQuery.eq("actor_user_id", scope.userId);
  }

  const [
    plays,
    trustRules,
    routines,
    runs,
    pages,
    learnings,
    receipts,
    monthCosts,
    actionMonthCosts,
    actionExecutions,
    members,
  ] = await Promise.all([
    supabaseService
      .from("brain_sales_plays")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .or(`owner_id.eq.${scope.userId},visibility.eq.team`)
      .order("updated_at", { ascending: false }),
    supabaseService
      .from("brain_trust_rules")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .match(scope.role === "owner" ? {} : { owner_id: scope.userId })
      .order("action_kind", { ascending: true }),
    supabaseService
      .from("brain_routines")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false }),
    supabaseService
      .from("brain_routine_runs")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .order("created_at", { ascending: false })
      .limit(60),
    supabaseService
      .from("brain_pages")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .or(`owner_id.eq.${scope.userId},visibility.eq.team`)
      .neq("status", "archived")
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false }),
    supabaseService
      .from("brain_learnings")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .or(`owner_id.eq.${scope.userId},and(visibility.eq.team,status.eq.approved_team)`)
      .order("updated_at", { ascending: false })
      .limit(80),
    supabaseService
      .from("assistant_messages")
      .select("id,content,action_sigs,created_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .not("action_sigs", "is", null)
      .order("created_at", { ascending: false })
      .limit(25),
    supabaseService
      .from("brain_routine_runs")
      .select("actual_cost_gbp")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .gte("created_at", monthStart.toISOString())
      .limit(1000),
    actionCostQuery,
    executionQuery,
    supabaseService
      .from("workspace_members")
      .select("user_id,role,status")
      .eq("workspace_id", scope.workspaceId)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
  ]);
  for (const result of [
    plays,
    trustRules,
    routines,
    runs,
    pages,
    learnings,
    receipts,
    monthCosts,
    actionMonthCosts,
    actionExecutions,
    members,
  ]) {
    if (result.error) throw result.error;
  }
  const routineRows = routines.data || [];
  const monthlyForecast = routineRows.reduce(
    (total: number, routine: any) =>
      total +
      Number(routine.estimated_cost_gbp || 0) *
        monthlyFrequency(routine.schedule_mode),
    0
  );
  const routineActualThisMonth = (monthCosts.data || []).reduce(
    (total: number, run: any) => total + Number(run.actual_cost_gbp || 0),
    0
  );
  const actionActualThisMonth = (actionMonthCosts.data || []).reduce(
    (total: number, execution: any) =>
      total + Number(execution.actual_cost_gbp || 0),
    0
  );
  const actualThisMonth = routineActualThisMonth + actionActualThisMonth;
  const memberIds = (members.data || []).map((member: any) => member.user_id);
  const { data: memberProfiles, error: memberProfilesError } = memberIds.length
    ? await supabaseService
        .from("profiles")
        .select("user_id,display_name,email")
        .in("user_id", memberIds)
    : { data: [], error: null };
  if (memberProfilesError) throw memberProfilesError;
  const profileByUser = new Map(
    (memberProfiles || []).map((profile: any) => [profile.user_id, profile])
  );
  return {
    generatedAt: new Date().toISOString(),
    currentUserId: scope.userId,
    role: scope.role,
    members: (members.data || []).map((member: any) => ({
      userId: member.user_id,
      role: member.role,
      displayName:
        profileByUser.get(member.user_id)?.display_name ||
        profileByUser.get(member.user_id)?.email ||
        "Workspace member",
      email: profileByUser.get(member.user_id)?.email || null,
    })),
    plays: plays.data || [],
    trustRules: trustRules.data || [],
    routines: routineRows,
    runs: runs.data || [],
    pages: pages.data || [],
    learnings: learnings.data || [],
    actionReceipts: (receipts.data || []).flatMap((message: any) =>
      arrayValue(message.action_sigs).map((receipt: any) => ({
        ...receipt,
        messageId: message.id,
        createdAt: message.created_at,
      }))
    ),
    actionExecutions: actionExecutions.data || [],
    costs: {
      currency: "GBP",
      forecastThisMonth: Number(monthlyForecast.toFixed(4)),
      actualThisMonth: Number(actualThisMonth.toFixed(4)),
      routines: routineRows.map((routine: any) => ({
        routineId: routine.id,
        name: routine.name,
        scheduleMode: routine.schedule_mode,
        runsPerMonth: monthlyFrequency(routine.schedule_mode),
        estimatedPerRun: Number(routine.estimated_cost_gbp || 0),
        hardCapPerRun: Number(routine.hard_cost_cap_gbp || 0),
        forecastPerMonth: Number(
          (
            Number(routine.estimated_cost_gbp || 0) *
            monthlyFrequency(routine.schedule_mode)
          ).toFixed(4)
        ),
      })),
    },
  };
}

export async function updateBrainTrustRule(
  scope: BrainScope,
  input: {
    actionKind: BrainActionKind;
    mode: BrainTrustMode;
    targetUserId?: string;
  }
) {
  if (scope.role !== "owner" || scope.status !== "active") {
    throw new Error("Only the active workspace owner can change Brain permissions");
  }
  if (!TRUST_DEFAULTS.some((rule) => rule.actionKind === input.actionKind)) {
    throw new Error("Choose a valid Brain action type");
  }
  if (!["auto", "approval_required", "blocked"].includes(input.mode)) {
    throw new Error("Choose a valid trust setting");
  }
  if (HARD_LOCKED_ACTIONS.has(input.actionKind)) {
    const allowed =
      input.actionKind === "destructive_action"
        ? ["blocked"]
        : ["approval_required", "blocked"];
    if (!allowed.includes(input.mode)) {
      throw new Error("This action can never run automatically");
    }
  }
  const targetUserId = clean(input.targetUserId || scope.userId, 80);
  const { data: target, error: targetError } = await supabaseService
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("user_id", targetUserId)
    .eq("status", "active")
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new Error("Choose an active workspace member");
  const { data, error } = await supabaseService
    .from("brain_trust_rules")
    .update({ mode: input.mode })
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", targetUserId)
    .eq("action_kind", input.actionKind)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function brainTrustDecision(
  scope: Pick<BrainScope, "userId" | "workspaceId">,
  actionKind: BrainActionKind
) {
  const { data, error } = await supabaseService
    .from("brain_trust_rules")
    .select("mode,hard_locked,reason")
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("action_kind", actionKind)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const fallback = TRUST_DEFAULTS.find((rule) => rule.actionKind === actionKind);
    return {
      mode: fallback?.mode || "blocked",
      hardLocked: fallback?.hardLocked ?? true,
      reason: fallback?.reason || "No trust rule exists, so Brain stopped.",
    };
  }
  return {
    mode: data.mode as BrainTrustMode,
    hardLocked: !!data.hard_locked,
    reason: data.reason,
  };
}

export async function saveBrainRoutine(scope: BrainScope, input: any) {
  const id = clean(input.id, 80);
  const scheduleMode = ["manual", "daily", "weekdays"].includes(input.scheduleMode)
    ? input.scheduleMode
    : "manual";
  const status = ["active", "paused"].includes(input.status) ? input.status : "active";
  const scheduledLocalTime = /^([01]\d|2[0-3]):[0-5]\d/.test(
    String(input.scheduledLocalTime || "")
  )
    ? String(input.scheduledLocalTime).slice(0, 5)
    : "07:30";
  const estimatedCost = finiteMoney(input.estimatedCostGbp);
  const hardCap = Math.max(estimatedCost, finiteMoney(input.hardCostCapGbp));
  const values = {
    name: clean(input.name, 120),
    description: clean(input.description, 1_600),
    schedule_mode: scheduleMode,
    scheduled_local_time: `${scheduledLocalTime}:00`,
    status,
    approval_mode: input.approvalMode === "auto_internal_only"
      ? "auto_internal_only"
      : "review_required",
    estimated_cost_gbp: estimatedCost,
    hard_cost_cap_gbp: hardCap,
    next_run_at:
      status === "active"
        ? nextRoutineRunAt({
            scheduleMode,
            scheduledLocalTime,
          })
        : null,
  };
  if (!values.name) throw new Error("Give the routine a name");
  if (!id) {
    const { data, error } = await supabaseService
      .from("brain_routines")
      .insert({
        workspace_id: scope.workspaceId,
        owner_id: scope.userId,
        visibility: "private",
        routine_kind: "morning_sales_control",
        timezone: "Europe/London",
        ...values,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabaseService
    .from("brain_routines")
    .update(values)
    .eq("id", id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function saveBrainPlay(scope: BrainScope, input: any) {
  const id = clean(input.id, 80);
  const visibility = input.visibility === "team" ? "team" : "private";
  if (visibility === "team" && !MANAGER_ROLES.has(scope.role)) {
    throw new Error("Only a workspace owner or manager can share a play with the team");
  }
  const name = clean(input.name, 120);
  const description = clean(input.description, 1_200);
  const steps = arrayValue(input.steps)
    .map((step) => clean(step, 500))
    .filter(Boolean)
    .slice(0, 20);
  if (!name || !steps.length) throw new Error("Give the play a name and at least one step");
  const estimatedCost = finiteMoney(input.estimatedCostGbp);
  const hardCap = Math.max(estimatedCost, finiteMoney(input.hardCostCapGbp));
  const values = {
    visibility,
    name,
    description,
    trigger_summary: clean(input.triggerSummary, 600),
    steps,
    approval_policy: {
      customerCommunication: "approval_required",
      crmUpdates: "approval_required",
      paidGeneration: "approval_required",
    },
    estimated_cost_gbp: estimatedCost,
    hard_cost_cap_gbp: hardCap,
  };
  if (!id) {
    const baseSlug = slugify(input.slug || name) || `play-${randomUUID().slice(0, 8)}`;
    const { data, error } = await supabaseService
      .from("brain_sales_plays")
      .insert({
        workspace_id: scope.workspaceId,
        owner_id: scope.userId,
        slug: `${baseSlug}-${randomUUID().slice(0, 6)}`,
        version: 1,
        status: "active",
        is_system: false,
        ...values,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabaseService
    .from("brain_sales_plays")
    .update(values)
    .eq("id", id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function saveBrainPage(scope: BrainScope, input: any) {
  const id = clean(input.id, 80);
  const visibility = input.visibility === "team" ? "team" : "private";
  if (visibility === "team" && !MANAGER_ROLES.has(scope.role)) {
    throw new Error("Only a workspace owner or manager can share a live page with the team");
  }
  const title = clean(input.title, 120);
  const widgets = [...new Set(arrayValue(input.widgets).map(String))]
    .filter((widget) => ALLOWED_WIDGETS.has(widget))
    .slice(0, 20);
  if (!title || !widgets.length) throw new Error("Give the page a title and at least one widget");
  const values = {
    visibility,
    title,
    description: clean(input.description, 1_000),
    widgets,
    status: "active",
  };
  if (!id) {
    const baseSlug = slugify(input.slug || title) || `page-${randomUUID().slice(0, 8)}`;
    const { data, error } = await supabaseService
      .from("brain_pages")
      .insert({
        workspace_id: scope.workspaceId,
        owner_id: scope.userId,
        slug: `${baseSlug}-${randomUUID().slice(0, 6)}`,
        is_default: false,
        ...values,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabaseService
    .from("brain_pages")
    .update(values)
    .eq("id", id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function proposeBrainLearning(scope: BrainScope, input: any) {
  const instruction = clean(input.instruction, 2_000);
  if (!instruction) throw new Error("Write the learning you want Brain to remember");
  const { data, error } = await supabaseService
    .from("brain_learnings")
    .insert({
      workspace_id: scope.workspaceId,
      owner_id: scope.userId,
      visibility: "private",
      status: "proposed",
      source_kind: ["routine", "team_chat", "brain_confirmation", "sales_outcome"].includes(
        input.sourceKind
      )
        ? input.sourceKind
        : "manual",
      source_ref: clean(input.sourceRef, 500) || null,
      instruction,
      expected_impact: clean(input.expectedImpact, 1_200),
      evidence:
        input.evidence && typeof input.evidence === "object" && !Array.isArray(input.evidence)
          ? input.evidence
          : {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function reviewBrainLearning(scope: BrainScope, input: any) {
  const id = clean(input.id, 80);
  const decision = String(input.decision || "");
  if (!id || !["approved_personal", "approved_team", "rejected"].includes(decision)) {
    throw new Error("Choose a valid learning decision");
  }
  if (decision === "approved_team" && !MANAGER_ROLES.has(scope.role)) {
    throw new Error("Only a workspace owner or manager can approve team learning");
  }
  const { data, error } = await supabaseService
    .from("brain_learnings")
    .update({
      status: decision,
      visibility: decision === "approved_team" ? "team" : "private",
      reviewed_by_user_id: scope.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("status", "proposed")
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function createBrainRoutineRun(input: {
  scope: Pick<BrainScope, "userId" | "workspaceId">;
  routineId: string;
  triggerKind: "manual" | "scheduled";
  idempotencyKey: string;
}) {
  const { data: routine, error: routineError } = await supabaseService
    .from("brain_routines")
    .select("*")
    .eq("id", input.routineId)
    .eq("workspace_id", input.scope.workspaceId)
    .eq("owner_id", input.scope.userId)
    .neq("status", "archived")
    .single();
  if (routineError) throw routineError;
  if (input.triggerKind === "scheduled" && routine.status !== "active") {
    throw new Error("This routine is not active");
  }
  const estimate = Number(routine.estimated_cost_gbp || 0);
  const hardCap = Number(routine.hard_cost_cap_gbp || 0);
  if (estimate > hardCap) throw new Error("The routine estimate is above its hard cost cap");
  const { data, error } = await supabaseService
    .from("brain_routine_runs")
    .insert({
      workspace_id: input.scope.workspaceId,
      owner_id: input.scope.userId,
      visibility: "private",
      routine_id: routine.id,
      trigger_kind: input.triggerKind,
      idempotency_key: clean(input.idempotencyKey, 240),
      status: "queued",
      current_step: 0,
      total_steps: 5,
      progress_message: "Queued safely",
      estimated_cost_gbp: estimate,
      actual_cost_gbp: 0,
      input_snapshot: {
        routineKind: routine.routine_kind,
        scheduleMode: routine.schedule_mode,
        approvalMode: routine.approval_mode,
        hardCostCapGbp: hardCap,
      },
    })
    .select("*")
    .single();
  if (error?.code === "23505") {
    const existing = await supabaseService
      .from("brain_routine_runs")
      .select("*")
      .eq("workspace_id", input.scope.workspaceId)
      .eq("owner_id", input.scope.userId)
      .eq("idempotency_key", clean(input.idempotencyKey, 240))
      .single();
    if (existing.error) throw existing.error;
    return { run: existing.data, routine, existing: true };
  }
  if (error) throw error;
  return { run: data, routine, existing: false };
}

const progress = async (
  scope: Pick<BrainScope, "userId" | "workspaceId">,
  runId: string,
  currentStep: number,
  progressMessage: string
) => {
  const { error } = await supabaseService
    .from("brain_routine_runs")
    .update({
      status: "running",
      current_step: currentStep,
      progress_message: progressMessage,
      started_at: currentStep === 1 ? new Date().toISOString() : undefined,
    })
    .eq("id", runId)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId);
  if (error) throw error;
};

export async function executeBrainRoutineRun(input: {
  scope: Pick<BrainScope, "userId" | "workspaceId">;
  routineId: string;
  runId: string;
}) {
  try {
    await progress(input.scope, input.runId, 1, "Reading your approval queues");
    const now = new Date();
    const nowIso = now.toISOString();
    const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
    const stalledBefore = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const [drafts, tasks, calls, opportunities, outreach] = await Promise.all([
      supabaseService
        .from("email_assistant_drafts")
        .select("id,recipient_name,recipient_email,intent,next_step,urgency,due_at,status,created_at")
        .eq("workspace_id", input.scope.workspaceId)
        .eq("owner_id", input.scope.userId)
        .in("status", ["draft", "failed"])
        .order("source_received_at", { ascending: false })
        .limit(20),
      supabaseService
        .from("tasks")
        .select("id,text,due_at,kind,company_id,created_at")
        .eq("workspace_id", input.scope.workspaceId)
        .eq("owner_id", input.scope.userId)
        .eq("status", "open")
        .not("due_at", "is", null)
        .lte("due_at", nowIso)
        .order("due_at", { ascending: true })
        .limit(20),
      supabaseService
        .from("upcoming_calls")
        .select("id,title,scheduled_at,intent,prepped,company_id")
        .eq("workspace_id", input.scope.workspaceId)
        .eq("owner_id", input.scope.userId)
        .is("completed_at", null)
        .gte("scheduled_at", nowIso)
        .lte("scheduled_at", in48Hours)
        .order("scheduled_at", { ascending: true })
        .limit(20),
      supabaseService
        .from("opportunities")
        .select("id,title,pipeline_stage,next_action,next_action_due_at,last_meaningful_activity_at,updated_at,value")
        .eq("workspace_id", input.scope.workspaceId)
        .or(`owner_id.eq.${input.scope.userId},assigned_to_user_id.eq.${input.scope.userId}`)
        .eq("status", "open")
        .eq("opportunity_type", "revenue")
        .order("updated_at", { ascending: true })
        .limit(100),
      supabaseService
        .from("outreach_enrolments")
        .select("id,status,researched_at,last_sent_at,replied_at,queued_for,campaign_id,prospect_id")
        .eq("workspace_id", input.scope.workspaceId)
        .eq("owner_id", input.scope.userId)
        .not("researched_at", "is", null)
        .is("replied_at", null)
        .in("status", ["queued", "active", "paused"])
        .order("researched_at", { ascending: false })
        .limit(100),
    ]);
    for (const result of [drafts, tasks, calls, opportunities, outreach]) {
      if (result.error) throw result.error;
    }
    await progress(input.scope, input.runId, 2, "Checking commitments and calls");

    const stalled = (opportunities.data || [])
      .filter((opportunity: any) => {
        const activity = opportunity.last_meaningful_activity_at || opportunity.updated_at;
        return activity && activity < stalledBefore;
      })
      .slice(0, 20);
    const readyOutreach = (outreach.data || [])
      .filter((enrolment: any) => !enrolment.last_sent_at)
      .slice(0, 20);
    await progress(input.scope, input.runId, 3, "Finding stalled deals and ready outreach");

    const counts = {
      replyDrafts: (drafts.data || []).length,
      overdueTasks: (tasks.data || []).length,
      upcomingCalls: (calls.data || []).length,
      stalledOpportunities: stalled.length,
      readyOutreach: readyOutreach.length,
    };
    const actions = [
      counts.replyDrafts
        ? {
            kind: "review_reply_drafts",
            label: `Review ${counts.replyDrafts} reply draft${counts.replyDrafts === 1 ? "" : "s"}`,
            href: "/crm/inbox?section=next-moves",
            priority: "high",
            requiresHumanAction: true,
          }
        : null,
      counts.overdueTasks
        ? {
            kind: "review_overdue_tasks",
            label: `Resolve ${counts.overdueTasks} overdue commitment${counts.overdueTasks === 1 ? "" : "s"}`,
            href: "/crm/inbox",
            priority: "high",
            requiresHumanAction: true,
          }
        : null,
      counts.upcomingCalls
        ? {
            kind: "prepare_upcoming_calls",
            label: `Prepare ${counts.upcomingCalls} call${counts.upcomingCalls === 1 ? "" : "s"} in the next 48 hours`,
            href: "/crm/calls",
            priority: "medium",
            requiresHumanAction: true,
          }
        : null,
      counts.stalledOpportunities
        ? {
            kind: "review_stalled_deals",
            label: `Review ${counts.stalledOpportunities} stalled ${counts.stalledOpportunities === 1 ? "opportunity" : "opportunities"}`,
            href: "/crm/revenue",
            priority: "medium",
            requiresHumanAction: true,
          }
        : null,
      counts.readyOutreach
        ? {
            kind: "use_ready_outreach",
            label: `${counts.readyOutreach} researched contact${counts.readyOutreach === 1 ? " is" : "s are"} ready`,
            href: "/crm/outreach",
            priority: "medium",
            requiresHumanAction: true,
          }
        : null,
    ].filter(Boolean);
    await progress(input.scope, input.runId, 4, "Building your live morning page");

    const output = {
      generatedAt: new Date().toISOString(),
      window: {
        callsThrough: in48Hours,
        stalledBefore,
      },
      counts,
      replyDrafts: drafts.data || [],
      overdueTasks: tasks.data || [],
      upcomingCalls: calls.data || [],
      stalledOpportunities: stalled,
      readyOutreach,
      safeguards: {
        externalMessagesSent: 0,
        crmRecordsChanged: 0,
        paidGenerationsCreated: 0,
        newResearchCreated: 0,
      },
    };
    const completedAt = new Date().toISOString();
    const { error: finishError } = await supabaseService
      .from("brain_routine_runs")
      .update({
        status: "completed",
        current_step: 5,
        progress_message: actions.length
          ? `${actions.length} human next move${actions.length === 1 ? "" : "s"} prepared`
          : "No urgent work found",
        output,
        proposed_actions: actions,
        actual_cost_gbp: 0,
        completed_at: completedAt,
      })
      .eq("id", input.runId)
      .eq("workspace_id", input.scope.workspaceId)
      .eq("owner_id", input.scope.userId);
    if (finishError) throw finishError;

    const { data: routine, error: routineReadError } = await supabaseService
      .from("brain_routines")
      .select("schedule_mode,scheduled_local_time")
      .eq("id", input.routineId)
      .eq("workspace_id", input.scope.workspaceId)
      .eq("owner_id", input.scope.userId)
      .single();
    if (routineReadError) throw routineReadError;
    const nextRun = nextRoutineRunAt({
      scheduleMode: routine.schedule_mode,
      scheduledLocalTime: routine.scheduled_local_time,
      from: new Date(completedAt),
    });
    const { error: routineUpdateError } = await supabaseService
      .from("brain_routines")
      .update({ last_run_at: completedAt, next_run_at: nextRun })
      .eq("id", input.routineId)
      .eq("workspace_id", input.scope.workspaceId)
      .eq("owner_id", input.scope.userId);
    if (routineUpdateError) throw routineUpdateError;
    return output;
  } catch (error: any) {
    await supabaseService
      .from("brain_routine_runs")
      .update({
        status: "failed",
        progress_message: "Stopped safely",
        error: clean(error?.message || "The routine could not complete", 1_600),
        completed_at: new Date().toISOString(),
      })
      .eq("id", input.runId)
      .eq("workspace_id", input.scope.workspaceId)
      .eq("owner_id", input.scope.userId);
    const { data: failedRoutine } = await supabaseService
      .from("brain_routines")
      .select("schedule_mode,scheduled_local_time")
      .eq("id", input.routineId)
      .eq("workspace_id", input.scope.workspaceId)
      .eq("owner_id", input.scope.userId)
      .maybeSingle();
    if (failedRoutine) {
      await supabaseService
        .from("brain_routines")
        .update({
          next_run_at: nextRoutineRunAt({
            scheduleMode: failedRoutine.schedule_mode,
            scheduledLocalTime: failedRoutine.scheduled_local_time,
          }),
        })
        .eq("id", input.routineId)
        .eq("workspace_id", input.scope.workspaceId)
        .eq("owner_id", input.scope.userId);
    }
    throw error;
  }
}
