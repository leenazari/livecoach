import "server-only";

import {
  mergeFocusBuild,
  type FocusBuildMode,
  type FocusBuildResult,
} from "@/lib/call-focus-build";
import { preserveCallLeadMetadata } from "@/lib/call-lead-context";
import type { RecordScope } from "@/lib/record-scope";
import { supabaseAdmin } from "@/lib/supabase";

export class FocusPersistenceError extends Error {
  status: number;
  code: string;
  nextAction: string;

  constructor(input: {
    message: string;
    status: number;
    code: string;
    nextAction: string;
  }) {
    super(input.message);
    this.name = "FocusPersistenceError";
    this.status = input.status;
    this.code = input.code;
    this.nextAction = input.nextAction;
  }
}

export async function verifyFocusBuildTarget(
  scope: RecordScope,
  upcomingId: string
) {
  const { data, error } = await supabaseAdmin
    .from("upcoming_calls")
    .select("id,company_id")
    .eq("id", upcomingId)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .maybeSingle();
  if (error) {
    console.error("focus target check failed", error);
    throw new FocusPersistenceError({
      message: "The scheduled call could not be checked before building focus",
      status: 500,
      code: "focus_target_check_failed",
      nextAction: "Return to Calls and reopen this meeting before building focus again",
    });
  }
  if (!data) {
    throw new FocusPersistenceError({
      message: "The scheduled call is not available in your account",
      status: 404,
      code: "focus_call_not_found",
      nextAction: "Return to Calls and open the current scheduled call before building focus again",
    });
  }
  return data;
}

export async function persistFocusBuild(input: {
  scope: RecordScope;
  upcomingId: string;
  mode: FocusBuildMode;
  replaceFocus?: boolean;
  brief: string;
  role: string;
  subjectName?: string;
  emailContext?: string;
  existingFocus?: unknown;
  selectedFocus?: unknown;
  planStage?: unknown;
  leadSelectionVersion?: unknown;
  intentSource?: unknown;
  intentVersion?: unknown;
  clientActivityContextSeen?: unknown;
  result: FocusBuildResult;
}) {
  const { data: current, error: readError } = await supabaseAdmin
    .from("upcoming_calls")
    .select("id,intent,prep,prepped")
    .eq("id", input.upcomingId)
    .eq("workspace_id", input.scope.workspaceId)
    .eq("owner_id", input.scope.userId)
    .maybeSingle();

  if (readError) {
    console.error("focus persistence read failed", readError);
    throw new FocusPersistenceError({
      message: "The focus finished, but the scheduled call could not be checked before saving",
      status: 500,
      code: "focus_save_read_failed",
      nextAction: "Keep this call open and ask a workspace owner to check the focus save support code",
    });
  }
  if (!current) {
    throw new FocusPersistenceError({
      message: "The scheduled call is no longer available in your account",
      status: 404,
      code: "focus_call_not_found",
      nextAction: "Return to Calls and open the current scheduled call before building focus again",
    });
  }

  const currentPrep =
    current.prep && typeof current.prep === "object" ? current.prep : {};
  const savedLeadVersion = (currentPrep as any)?.leadSelection?.savedAt || null;
  const requestedLeadVersion =
    typeof input.leadSelectionVersion === "string"
      ? input.leadSelectionVersion
      : null;
  if (savedLeadVersion && requestedLeadVersion !== savedLeadVersion) {
    throw new FocusPersistenceError({
      message: "The meeting lead changed while the focus was building",
      status: 409,
      code: "focus_lead_changed",
      nextAction: "Reopen prep and build focus for the lead that is now saved on the call",
    });
  }

  const intentMeta = (currentPrep as any)?.intentMeta;
  const requestedIntentVersion =
    typeof input.intentVersion === "string" ? input.intentVersion : null;
  const currentIntentVersion =
    typeof intentMeta?.savedAt === "string" ? intentMeta.savedAt : null;
  const manualIntent = input.intentSource === "manual";
  const canonicalIntent = String(current.intent || "").trim();
  const requestedIntent = input.brief.trim();

  if (
    manualIntent &&
    intentMeta?.source === "manual" &&
    currentIntentVersion &&
    requestedIntentVersion !== currentIntentVersion
  ) {
    throw new FocusPersistenceError({
      message: "The call intent changed in another tab while the focus was building",
      status: 409,
      code: "focus_intent_changed",
      nextAction: "Reopen prep, keep the current intent and build the focus again",
    });
  }
  if (
    !manualIntent &&
    canonicalIntent &&
    requestedIntent &&
    canonicalIntent !== requestedIntent
  ) {
    throw new FocusPersistenceError({
      message: "The call intent changed while the focus was building",
      status: 409,
      code: "focus_intent_changed",
      nextAction: "Reopen prep and build focus from the latest saved intent",
    });
  }

  const merged = mergeFocusBuild({
    mode: input.mode,
    replaceFocus: input.replaceFocus,
    existingFocus: input.existingFocus,
    selectedFocus: input.selectedFocus,
    result: input.result,
  });
  if (!merged.suggestedFocus.length) {
    throw new FocusPersistenceError({
      message: "The focus builder did not produce a usable focus",
      status: 422,
      code: "focus_empty",
      nextAction: "Add a clear call intent, then build the focus again",
    });
  }

  const savedAt = new Date().toISOString();
  const existingStage =
    input.planStage === "full" || input.planStage === "focus"
      ? input.planStage
      : (currentPrep as any)?.planStage;
  const planStage =
    input.mode === "focus"
      ? "focus"
      : existingStage === "full"
        ? "full"
        : "focus";
  const nextPrep = preserveCallLeadMetadata(currentPrep, {
    ...currentPrep,
    version: 1,
    leadSelectionVersion: savedLeadVersion,
    brief: requestedIntent,
    role: input.role,
    callType:
      typeof input.result.callType === "string"
        ? input.result.callType
        : (currentPrep as any)?.callType || "general",
    candidate:
      (typeof input.subjectName === "string" && input.subjectName.trim()) ||
      (typeof input.result.subjectName === "string" &&
        input.result.subjectName.trim()) ||
      (currentPrep as any)?.candidate ||
      "",
    character:
      typeof input.result.character === "string"
        ? input.result.character
        : (currentPrep as any)?.character || "",
    suggestedComps: merged.suggestedFocus,
    selectedComps: merged.selectedFocus,
    planStage,
    focusBasisBrief: requestedIntent,
    focusBasisEmailContext:
      typeof input.emailContext === "string" ? input.emailContext : "",
    clientActivityContextSeen:
      typeof input.clientActivityContextSeen === "string"
        ? input.clientActivityContextSeen
        : null,
    savedAt,
    focusBuild: {
      status: "completed",
      completedAt: savedAt,
      degraded: input.result.degraded === true,
    },
  });
  if (manualIntent) {
    (nextPrep as any).intentMeta = {
      ...(intentMeta || {}),
      source: "manual",
      savedAt,
    };
  }

  let save = supabaseAdmin
    .from("upcoming_calls")
    .update({
      prep: nextPrep,
      prepped: true,
      ...(manualIntent ? { intent: requestedIntent || null } : {}),
    })
    .eq("id", input.upcomingId)
    .eq("workspace_id", input.scope.workspaceId)
    .eq("owner_id", input.scope.userId);
  save = current.prep == null
    ? save.is("prep", null)
    : save.eq("prep", JSON.stringify(current.prep));
  save = current.intent == null
    ? save.is("intent", null)
    : save.eq("intent", current.intent);
  const { data: saved, error: saveError } = await save
    .select("id,intent,prep,prepped")
    .maybeSingle();

  if (saveError) {
    console.error("focus persistence save failed", saveError);
    throw new FocusPersistenceError({
      message: "The focus finished, but its save could not be confirmed",
      status: 500,
      code: "focus_save_failed",
      nextAction: "Reopen this call and check whether the focus is present before building it again",
    });
  }
  if (!saved) {
    throw new FocusPersistenceError({
      message: "The call changed while the completed focus was being saved",
      status: 409,
      code: "focus_save_conflict",
      nextAction: "Reopen prep to use the current lead and intent, then build focus again if it is missing",
    });
  }

  return {
    saved,
    suggestedFocus: merged.suggestedFocus,
    selectedFocus: merged.selectedFocus,
    added: merged.added,
    upgraded: merged.upgraded,
  };
}
