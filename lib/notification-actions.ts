import { z } from "zod";

export const notificationActionInput = z.object({
  requestId: z.uuid(),
  mode: z.enum(["done", "log"]),
  note: z.string().trim().max(4000).default(""),
  channel: z.enum(["note", "phone", "email", "linkedin", "video_call", "in_person", "other"]).default("note"),
  complete: z.boolean().default(true),
  nextAction: z.string().trim().max(600).default(""),
  dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.mode === "log" && !value.note) context.addIssue({ code: "custom", message: "Describe what you did before saving" });
  if (value.dueAt && !value.nextAction) context.addIssue({ code: "custom", message: "Add the next step for this due date" });
  if (value.mode === "done" && (value.note || value.nextAction || value.dueAt || !value.complete || value.channel !== "note")) {
    context.addIssue({ code: "custom", message: "Use Log action to record details or a next step" });
  }
});

export type NotificationActionReceipt = {
  ok: true;
  contextId: string;
  companyId: string | null;
  prospectId: string | null;
  taskId: string | null;
  nextTaskId: string | null;
  opportunityId: string | null;
  callId: string | null;
  completed: boolean;
  alreadySaved: boolean;
  pipelineNeedsSelection: boolean;
};

export function announceNotificationAction(receipt: NotificationActionReceipt) {
  for (const name of ["lc:tasks-updated", "lc:crm-updated", "lc:outreach-updated", "lc:notifications-updated", "lc:client-activity-updated"]) {
    window.dispatchEvent(new CustomEvent(name, { detail: receipt }));
  }
}
