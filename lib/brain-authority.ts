import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { BrainActionKind, BrainScope } from "@/lib/brain-control";

const TOKEN_VERSION = 1;
const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_ACTION_BYTES = 60_000;

export type BrainActionRisk =
  | "reversible_internal"
  | "internal_communication"
  | "external_communication"
  | "paid_generation"
  | "destructive";

export type BrainAuthorityProfile = {
  actionKind: BrainActionKind;
  risk: BrainActionRisk;
  requiresSeparateApproval: boolean;
  ownerOnly: boolean;
  managerAllowed: boolean;
  salesAllowed?: boolean;
  canOwnerOverride: boolean;
  canRetry: boolean;
};

export type SignedBrainAction = {
  type: string;
  label: string;
  endpoint: string;
  method: "POST" | "PATCH" | "DELETE";
  body: Record<string, unknown>;
  external?: boolean;
  batchSafe?: boolean;
  estimatedCostGbp?: number;
};

export type BrainActionTokenPayload = {
  v: 1;
  jti: string;
  actorUserId: string;
  workspaceId: string;
  actorRole: BrainScope["role"];
  actionType: string;
  actionKind: BrainActionKind;
  risk: BrainActionRisk;
  ownerOverrideRequested: boolean;
  issuedAt: number;
  expiresAt: number;
  action: SignedBrainAction;
};

const ACTION_PROFILES: Record<string, BrainAuthorityProfile> = {
  create_calendar_event: {
    actionKind: "customer_communication",
    risk: "external_communication",
    requiresSeparateApproval: true,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: false,
    canRetry: true,
  },
  reschedule_call: {
    actionKind: "customer_communication",
    risk: "external_communication",
    requiresSeparateApproval: true,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: false,
    canRetry: true,
  },
  cancel_call: {
    actionKind: "customer_communication",
    risk: "destructive",
    requiresSeparateApproval: true,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: false,
    canRetry: false,
  },
  send_email: {
    actionKind: "customer_communication",
    risk: "external_communication",
    requiresSeparateApproval: true,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: true,
    canRetry: true,
  },
  sendpilot_enrol: {
    actionKind: "customer_communication",
    risk: "external_communication",
    requiresSeparateApproval: true,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: true,
    // SendPilot does not expose an idempotency key for lead creation. A timeout
    // can therefore be an unknown provider success and must be reconciled first.
    canRetry: false,
  },
  sendpilot_stop_lead: {
    actionKind: "customer_communication",
    risk: "destructive",
    requiresSeparateApproval: true,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: false,
    canRetry: false,
  },
  sendpilot_pause_campaign: {
    actionKind: "customer_communication",
    risk: "external_communication",
    requiresSeparateApproval: true,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: false,
    canRetry: false,
  },
  sendpilot_resume_campaign: {
    actionKind: "customer_communication",
    risk: "external_communication",
    requiresSeparateApproval: true,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: false,
    canRetry: false,
  },
  approve_outreach: {
    actionKind: "customer_communication",
    risk: "external_communication",
    requiresSeparateApproval: true,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: true,
    canRetry: true,
  },
  create_voice_note: {
    actionKind: "paid_generation",
    risk: "paid_generation",
    requiresSeparateApproval: true,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: false,
    canRetry: true,
  },
  create_document: {
    actionKind: "paid_generation",
    risk: "paid_generation",
    requiresSeparateApproval: true,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: false,
    canRetry: true,
  },
  prepare_outreach: {
    actionKind: "paid_generation",
    risk: "paid_generation",
    requiresSeparateApproval: true,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: false,
    canRetry: true,
  },
  prepare_reply: {
    actionKind: "paid_generation",
    risk: "paid_generation",
    requiresSeparateApproval: true,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: false,
    canRetry: true,
  },
  share_in_chat: {
    actionKind: "customer_communication",
    risk: "internal_communication",
    requiresSeparateApproval: true,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: false,
    canRetry: true,
  },
  create_chat: {
    actionKind: "update_internal_crm",
    risk: "reversible_internal",
    requiresSeparateApproval: false,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: false,
    // A timed-out group creation is ambiguous because the chat API has no
    // provider-style idempotency key. Never create a duplicate room by retrying.
    canRetry: false,
  },
  promote_to_pipeline: {
    actionKind: "update_internal_crm",
    risk: "reversible_internal",
    requiresSeparateApproval: false,
    ownerOnly: false,
    managerAllowed: true,
    canOwnerOverride: false,
    canRetry: true,
  },
  assign_work: {
    actionKind: "update_internal_crm",
    risk: "reversible_internal",
    requiresSeparateApproval: false,
    ownerOnly: true,
    managerAllowed: false,
    salesAllowed: false,
    canOwnerOverride: true,
    canRetry: true,
  },
  stage_outreach_import: {
    actionKind: "update_internal_crm",
    risk: "reversible_internal",
    requiresSeparateApproval: false,
    ownerOnly: true,
    managerAllowed: false,
    salesAllowed: false,
    canOwnerOverride: false,
    canRetry: true,
  },
  merge_duplicate_clients: {
    actionKind: "destructive_action",
    risk: "destructive",
    requiresSeparateApproval: true,
    ownerOnly: true,
    managerAllowed: false,
    canOwnerOverride: true,
    canRetry: false,
  },
};

const DEFAULT_PROFILE: BrainAuthorityProfile = {
  actionKind: "update_internal_crm",
  risk: "reversible_internal",
  requiresSeparateApproval: false,
  ownerOnly: false,
  managerAllowed: true,
  canOwnerOverride: true,
  canRetry: true,
};

const ACTION_ENDPOINTS: Record<string, RegExp[]> = {
  set_meeting_link: [/^\/api\/crm\/upcoming\/[0-9a-f-]+$/i],
  set_intent: [/^\/api\/crm\/upcoming\/[0-9a-f-]+$/i],
  add_intent: [/^\/api\/crm\/upcoming\/[0-9a-f-]+$/i],
  link_call: [/^\/api\/crm\/upcoming\/[0-9a-f-]+$/i],
  reschedule_call: [/^\/api\/crm\/upcoming\/[0-9a-f-]+$/i],
  create_calendar_event: [/^\/api\/crm\/upcoming$/],
  cancel_call: [/^\/api\/crm\/upcoming\/[0-9a-f-]+\/cancel$/i],
  create_client: [/^\/api\/crm\/companies$/],
  update_client: [/^\/api\/crm\/companies\/[0-9a-f-]+$/i],
  update_contact: [/^\/api\/crm\/contacts\/[0-9a-f-]+$/i],
  link_contact_to_client: [/^\/api\/crm\/contacts\/[0-9a-f-]+$/i],
  upsert_stakeholder: [
    /^\/api\/crm\/contacts$/,
    /^\/api\/crm\/contacts\/[0-9a-f-]+$/i,
  ],
  log_client_update: [/^\/api\/crm\/companies\/[0-9a-f-]+\/activity$/i],
  create_document: [/^\/api\/crm\/documents$/],
  create_task: [/^\/api\/crm\/tasks$/],
  update_task: [/^\/api\/crm\/tasks\/[0-9a-f-]+$/i],
  create_campaign: [/^\/api\/crm\/outreach\/campaigns$/],
  update_campaign: [/^\/api\/crm\/outreach\/campaigns\/[0-9a-f-]+$/i],
  build_outreach_queue: [/^\/api\/crm\/outreach\/queue$/],
  send_email: [/^\/api\/crm\/assistant\/email$/],
  update_opportunity: [/^\/api\/crm\/opportunities\/[0-9a-f-]+$/i],
  promote_to_pipeline: [
    /^\/api\/crm\/companies\/[0-9a-f-]+\/pipeline$/i,
  ],
  resolve_opportunity_clarification: [
    /^\/api\/crm\/opportunity-clarifications\/[0-9a-f-]+$/i,
  ],
  pull_emails: [/^\/api\/crm\/email-pull$/],
  remember: [/^\/api\/crm\/brain\/remember$/],
  correct: [/^\/api\/crm\/companies\/[0-9a-f-]+\/correct$/i],
  dismiss: [
    /^\/api\/crm\/follow-ups\/[0-9a-f-]+$/i,
    /^\/api\/crm\/tasks\/[0-9a-f-]+$/i,
  ],
  assign_work: [
    /^\/api\/crm\/outreach\/assign$/,
    /^\/api\/crm\/brain\/assign-work$/,
    /^\/api\/crm\/team\/sharing$/,
    /^\/api\/crm\/opportunities\/[0-9a-f-]+$/i,
  ],
  stage_outreach_import: [/^\/api\/crm\/imports\/outreach\/stage$/],
  sendpilot_enrol: [/^\/api\/crm\/outreach\/[0-9a-f-]+\/sendpilot$/i],
  sendpilot_stop_lead: [/^\/api\/crm\/sendpilot\/control$/],
  sendpilot_pause_campaign: [/^\/api\/crm\/sendpilot\/control$/],
  sendpilot_resume_campaign: [/^\/api\/crm\/sendpilot\/control$/],
  prepare_outreach: [/^\/api\/crm\/outreach\/[0-9a-f-]+\/prepare$/i],
  prepare_reply: [/^\/api\/crm\/outreach\/replies\/[0-9a-f-]+\/draft$/i],
  approve_outreach: [
    /^\/api\/crm\/outreach\/messages\/[0-9a-f-]+\/send$/i,
    /^\/api\/crm\/brain\/outreach-approve$/,
  ],
  create_voice_note: [
    /^\/api\/crm\/outreach\/messages\/[0-9a-f-]+\/(?:voice|voice-script)$/i,
    /^\/api\/crm\/brain\/outreach-voice$/,
  ],
  log_sequence_action: [
    /^\/api\/crm\/outreach\/[0-9a-f-]+\/sequence-action$/i,
  ],
  create_follow_up: [/^\/api\/crm\/outreach\/[0-9a-f-]+\/follow-up$/i],
  create_chat: [/^\/api\/crm\/chat$/],
  share_in_chat: [
    /^\/api\/crm\/chat\/[0-9a-f-]+\/messages$/i,
    /^\/api\/crm\/brain\/share$/,
  ],
  merge_duplicate_clients: [/^\/api\/crm\/duplicates\/merge$/],
};

export function brainAuthorityProfile(actionType: string): BrainAuthorityProfile {
  return ACTION_PROFILES[actionType] || DEFAULT_PROFILE;
}

export function explicitOwnerOverrideRequested(message: string): boolean {
  return /\b(?:owner\s+override|override\s+(?:the\s+)?(?:block|blocker|rule|restriction|workflow)|force\s+(?:this|it|the\s+action)|do\s+it\s+anyway|go\s+ahead\s+anyway|bypass\s+the\s+(?:normal\s+)?workflow)\b/i.test(
    String(message || "")
  );
}

function signingSecret() {
  const value =
    process.env.BRAIN_ACTION_SIGNING_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  if (value.length < 32) {
    throw new Error("Brain action signing is not configured");
  }
  return value;
}

function signature(encoded: string) {
  return createHmac("sha256", signingSecret()).update(encoded).digest("base64url");
}

function safeAction(action: any): SignedBrainAction {
  const type = String(action?.type || "").trim();
  const endpoint = String(action?.endpoint || "").trim();
  const method = String(action?.method || "PATCH").toUpperCase();
  const allowedEndpoints = ACTION_ENDPOINTS[type] || [];
  if (!type || !allowedEndpoints.some((pattern) => pattern.test(endpoint))) {
    throw new Error("Brain action endpoint is not permitted");
  }
  if (!(["POST", "PATCH", "DELETE"] as string[]).includes(method)) {
    throw new Error("Brain action method is not permitted");
  }
  const body =
    action?.body && typeof action.body === "object" && !Array.isArray(action.body)
      ? action.body
      : {};
  const cleanAction: SignedBrainAction = {
    type,
    label: String(action?.label || type).trim().slice(0, 1000),
    endpoint,
    method: method as SignedBrainAction["method"],
    body,
    external: action?.external === true,
    batchSafe: action?.batchSafe === true,
    estimatedCostGbp: Number.isFinite(Number(action?.estimatedCostGbp))
      ? Math.max(
          0,
          Math.min(100, Number(Number(action.estimatedCostGbp).toFixed(6)))
        )
      : 0,
  };
  if (Buffer.byteLength(JSON.stringify(cleanAction), "utf8") > MAX_ACTION_BYTES) {
    throw new Error("Brain action is too large to sign safely");
  }
  return cleanAction;
}

export function signBrainAction(input: {
  scope: BrainScope;
  action: any;
  ownerOverrideRequested?: boolean;
}) {
  const action = safeAction(input.action);
  const profile = brainAuthorityProfile(action.type);
  const now = Date.now();
  const payload: BrainActionTokenPayload = {
    v: TOKEN_VERSION,
    jti: randomUUID(),
    actorUserId: input.scope.userId,
    workspaceId: input.scope.workspaceId,
    actorRole: input.scope.role,
    actionType: action.type,
    actionKind: profile.actionKind,
    risk: profile.risk,
    ownerOverrideRequested:
      input.scope.role === "owner" && input.ownerOverrideRequested === true,
    issuedAt: now,
    expiresAt: now + TOKEN_LIFETIME_MS,
    action,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifyBrainActionToken(
  token: string,
  scope: Pick<BrainScope, "userId" | "workspaceId" | "role">
): BrainActionTokenPayload {
  const [encoded, suppliedSignature, extra] = String(token || "").split(".");
  if (!encoded || !suppliedSignature || extra) {
    throw new Error("This Brain action is missing a valid approval token");
  }
  const expected = Buffer.from(signature(encoded));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error("This Brain action was changed after it was prepared");
  }
  let payload: BrainActionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("This Brain action token could not be read");
  }
  if (
    payload.v !== TOKEN_VERSION ||
    payload.actorUserId !== scope.userId ||
    payload.workspaceId !== scope.workspaceId ||
    payload.actorRole !== scope.role ||
    payload.expiresAt < Date.now()
  ) {
    throw new Error("This Brain action is expired or belongs to another account");
  }
  const action = safeAction(payload.action);
  const profile = brainAuthorityProfile(payload.actionType);
  if (
    action.type !== payload.actionType ||
    profile.actionKind !== payload.actionKind ||
    profile.risk !== payload.risk
  ) {
    throw new Error("This Brain action does not match its authority policy");
  }
  return { ...payload, action };
}

export function brainRoleMayExecute(
  scope: Pick<BrainScope, "role">,
  profile: BrainAuthorityProfile
) {
  if (profile.ownerOnly) return scope.role === "owner";
  if (!profile.managerAllowed && scope.role === "manager") return false;
  if (profile.salesAllowed === false && scope.role === "sales") return false;
  return true;
}

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)])
    );
  }
  return value;
};

export function verifyBrainOwnerOverride(input: {
  token: string;
  scope: Pick<BrainScope, "userId" | "workspaceId" | "role">;
  actionType: string;
  endpoint: string;
  method: string;
  body: Record<string, unknown>;
}) {
  try {
    const payload = verifyBrainActionToken(input.token, input.scope);
    const profile = brainAuthorityProfile(payload.actionType);
    return (
      input.scope.role === "owner" &&
      payload.ownerOverrideRequested === true &&
      profile.canOwnerOverride &&
      payload.actionType === input.actionType &&
      payload.action.endpoint === input.endpoint &&
      payload.action.method === input.method.toUpperCase() &&
      JSON.stringify(canonicalValue(payload.action.body)) ===
        JSON.stringify(canonicalValue(input.body))
    );
  } catch {
    return false;
  }
}
