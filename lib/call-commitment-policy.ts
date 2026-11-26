export type CallCommitmentTask = {
  id: string;
  text: string;
  status: string;
  kind: string;
  source: string | null;
  due_at?: string | null;
  payload?: Record<string, any> | null;
};

// Preparation is evidence of work still owed, never evidence of delivery.
export function isCallDeliverable(task: CallCommitmentTask): boolean {
  return task.kind === "commitment" && task.source === "call" &&
    task.payload?.ownerType === "me" &&
    ["email", "document"].includes(task.payload?.preparationKind);
}

export function callCommitmentNeedsAttention(task: CallCommitmentTask, now: Date): boolean {
  if (!isCallDeliverable(task) || task.status !== "open") return false;
  const deferred = Date.parse(task.payload?.commitmentSnoozedUntil || "");
  return !Number.isFinite(deferred) || deferred <= now.getTime();
}

export function commitmentReminderWindow(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const day = parts.find(p => p.type === "weekday")?.value;
  const hour = Number(parts.find(p => p.type === "hour")?.value);
  return day !== "Sat" && day !== "Sun" && hour >= 9 && hour < 18;
}

export function commitmentReminderDue(receipt: any, now: Date): boolean {
  if (!receipt) return true;
  if (receipt.dismissed_at) return false;
  const snooze = Date.parse(receipt.snoozed_until || "");
  if (Number.isFinite(snooze) && snooze > now.getTime()) return false;
  const last = Date.parse(receipt.attention_at || receipt.created_at || "");
  return !Number.isFinite(last) || now.getTime() - last >= 2 * 60 * 60 * 1000;
}

export function commitmentReminderCopy(task: CallCommitmentTask) {
  const missing = Array.isArray(task.payload?.missingDetails) ? task.payload.missingDetails.filter(Boolean) : [];
  return {
    title: missing.length ? "Promised follow-up needs information" : "Promised follow-up still outstanding",
    body: `${task.text} ${task.payload?.deliverableDraft?.reason || (missing.length ? `Missing: ${missing.join(" ")}` : task.payload?.deliverableDraft?.status === "ready" ? "Your mailbox draft and approved attachments are ready to review in Gmail." : "Prepared content is available in Tasks.")} Review and send it, mark it done, or snooze/dismiss this reminder. Reading this alert does not complete the task.`.slice(0, 1000),
  };
}
