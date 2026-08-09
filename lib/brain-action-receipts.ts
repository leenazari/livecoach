export type BrainActionReceiptResult = {
  label: string;
  status: "completed" | "not_completed";
  reason?: string;
  action?: {
    type: string;
    label: string;
    endpoint: string;
    body?: Record<string, unknown>;
  };
};

const clean = (value: unknown, limit: number) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

export function normaliseBrainActionReceiptResults(
  value: unknown
): BrainActionReceiptResult[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 6)
    .map((item: any) => {
      const action = item?.action;
      return {
        label: clean(item?.label, 500),
        status:
          item?.status === "completed"
            ? ("completed" as const)
            : ("not_completed" as const),
        reason: clean(item?.reason, 300) || undefined,
        action:
          action && typeof action.type === "string"
            ? {
                type: clean(action.type, 80),
                label: clean(action.label || item?.label, 500),
                endpoint: clean(action.endpoint, 500),
                body:
                  action.body && typeof action.body === "object"
                    ? action.body
                    : undefined,
              }
            : undefined,
      };
    })
    .filter((item) => item.label);
}

export function formatBrainActionReceipt(
  results: BrainActionReceiptResult[],
  screenLabel?: string,
  now = new Date()
): string {
  const completed = results.filter((item) => item.status === "completed");
  const notCompleted = results.filter(
    (item) => item.status === "not_completed"
  );
  const when = now.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const where = clean(screenLabel, 80);
  const lines = [
    `BRAIN ACTION RECEIPT · ${when}${where ? ` · ${where}` : ""}`,
  ];
  if (completed.length) {
    lines.push("", `✓ Completed (${completed.length})`);
    for (const item of completed) lines.push(`• ${item.label}`);
  }
  if (notCompleted.length) {
    lines.push("", `⚠ Not completed (${notCompleted.length})`);
    for (const item of notCompleted)
      lines.push(
        `• ${item.label}${item.reason ? ` — ${item.reason}` : " — No change was made."}`
      );
  }
  return lines.join("\n");
}
