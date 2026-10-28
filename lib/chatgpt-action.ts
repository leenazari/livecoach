import "server-only";

import { publicAppOrigin } from "@/lib/public-app-url";
import type { StaffCoreActionName } from "@/lib/staff-mcp-tools";

export const CHATGPT_ACTIONS = [
  {
    slug: "find-my-lead",
    tool: "find_my_lead",
    operationId: "findMyLiveCoachLead",
    readOnly: true,
  },
  {
    slug: "list-my-leads",
    tool: "list_my_leads",
    operationId: "listMyLiveCoachLeads",
    readOnly: true,
  },
  {
    slug: "add-lead",
    tool: "add_lead",
    operationId: "addMyLiveCoachLead",
    readOnly: false,
  },
  {
    slug: "add-lead-context",
    tool: "add_lead_context",
    operationId: "addContextToMyLiveCoachLead",
    readOnly: false,
  },
  {
    slug: "create-my-follow-up",
    tool: "create_my_follow_up",
    operationId: "createMyLiveCoachFollowUp",
    readOnly: false,
  },
  {
    slug: "list-my-tasks",
    tool: "list_my_tasks",
    operationId: "listMyLiveCoachTasks",
    readOnly: true,
  },
] as const satisfies ReadonlyArray<{
  slug: string;
  tool: StaffCoreActionName;
  operationId: string;
  readOnly: boolean;
}>;

export function chatGptActionForSlug(slug: string) {
  return CHATGPT_ACTIONS.find((action) => action.slug === slug) || null;
}

export function chatGptActionSchemaUrl(): string {
  return `${publicAppOrigin()}/api/chatgpt/actions/openapi`;
}

export function chatGptActionCallbackUrls(gptId: string): string[] {
  return [
    `https://chat.openai.com/aip/${gptId}/oauth/callback`,
    `https://chatgpt.com/aip/${gptId}/oauth/callback`,
  ];
}

export function normaliseChatGptId(value: unknown): string | null {
  const input = String(value || "").trim();
  const exact = input.match(/^g-[A-Za-z0-9_-]{3,160}$/);
  if (exact) return exact[0];
  const fromUrl = input.match(/(?:^|[/?#=])(g-[A-Za-z0-9_-]{3,160})(?=$|[/?#&])/);
  return fromUrl?.[1] || null;
}
