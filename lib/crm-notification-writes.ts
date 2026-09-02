import "server-only";

import { supabaseService } from "@/lib/supabase";

type NotificationSourceTable =
  | "companies"
  | "outreach_prospects"
  | "opportunities";

type ImportantEmailNotification = {
  workspaceId: string;
  userId: string;
  title: string;
  body: string;
  href: string;
  sourceTable: NotificationSourceTable;
  sourceId: string;
  sourceEventKey: string;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const limited = (value: unknown, maximum: number) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);

// Notifications are delivery receipts, not a second source of truth. Only a
// verified active member can receive one, and the stable source key makes a
// retried mailbox delta idempotent.
export async function createImportantEmailNotification(
  input: ImportantEmailNotification
): Promise<{ created: boolean; id: string | null }> {
  if (
    !UUID.test(input.workspaceId) ||
    !UUID.test(input.userId) ||
    !UUID.test(input.sourceId) ||
    !input.href.startsWith("/")
  ) {
    throw new Error("Important email notification scope is invalid");
  }

  const { data: membership, error: membershipError } = await supabaseService
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) return { created: false, id: null };

  const { data, error } = await supabaseService
    .from("crm_notifications")
    .upsert(
      {
        workspace_id: input.workspaceId,
        user_id: input.userId,
        kind: "important_email",
        title: limited(input.title, 160),
        body: limited(input.body, 1000),
        href: limited(input.href, 500),
        source_table: input.sourceTable,
        source_id: input.sourceId,
        source_event_key: limited(input.sourceEventKey, 300),
      },
      {
        onConflict: "user_id,source_event_key",
        ignoreDuplicates: true,
      }
    )
    .select("id");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return { created: !!row?.id, id: row?.id ? String(row.id) : null };
}
