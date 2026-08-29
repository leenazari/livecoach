import { NextRequest, NextResponse } from "next/server";

import { listActiveAccountScopes } from "@/lib/automation-accounts";
import { resolveClientEmailTarget } from "@/lib/client-email-activity";
import {
  generateEmailAssistantDraft,
  type EmailDraftUrgency,
} from "@/lib/email-assistant";
import {
  connectedMailProvider,
  freshMessageText,
  type MailMessage,
  type MailProvider,
} from "@/lib/mail";
import { runWithServiceRecordScope } from "@/lib/service-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const clean = (value: unknown, maximum: number) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);

const validProvider = (value: unknown): value is MailProvider =>
  value === "google" || value === "microsoft";

const validUrgency = (value: unknown): EmailDraftUrgency =>
  value === "urgent" || value === "high" ? value : "normal";

async function runAccount(account: { userId: string; workspaceId: string }) {
  const connection = await connectedMailProvider(account.userId);
  if (!connection.provider) {
    return { queued: 0, created: 0, reused: 0, failed: 0, skipped: "No mailbox" };
  }
  const { data, error } = await supabaseService
    .from("tasks")
    .select("id,company_id,payload,created_at")
    .eq("workspace_id", account.workspaceId)
    .eq("owner_id", account.userId)
    .eq("status", "open")
    .eq("source", "important_email_monitor")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  const tasks = (data || [])
    .filter(
      (task: any) =>
        task?.payload?.draftMode === "overnight" &&
        task?.payload?.replyRecommended === true
    )
    .slice(0, 25);
  let created = 0;
  let reused = 0;
  let failed = 0;

  // Three at a time keeps the morning run fast without creating a burst of
  // model calls for every salesperson at once.
  for (let index = 0; index < tasks.length; index += 3) {
    const batch = tasks.slice(index, index + 3);
    const results = await Promise.all(
      batch.map(async (task: any) => {
        try {
          const payload = task.payload || {};
          if (!validProvider(payload.mailProvider)) {
            throw new Error("The source mail provider is invalid");
          }
          if (payload.mailProvider !== connection.provider) {
            throw new Error("The connected mailbox provider changed after this email arrived");
          }
          const sender = clean(payload.sender, 320).toLowerCase();
          const messageId = clean(payload.mailMessageId, 1_000);
          if (!sender || !messageId) throw new Error("The source email identity is incomplete");
          const target = await resolveClientEmailTarget(sender);
          if (target.ambiguous) throw new Error("The sender matches more than one CRM record");
          const body = await freshMessageText(messageId, 5_000, account.userId);
          if (!body) throw new Error("The fresh source email is unavailable");
          const message: MailMessage = {
            id: messageId,
            threadId: clean(payload.mailThreadId, 1_000),
            date: clean(payload.receivedAt, 80),
            from: clean(payload.senderHeader, 320) || sender,
            to: "",
            cc: "",
            subject: clean(payload.subject, 240),
            snippet: clean(payload.summary, 1_000),
          };
          const result = await generateEmailAssistantDraft({
            provider: payload.mailProvider,
            message,
            freshText: body,
            target,
            summary: clean(payload.summary, 500),
            action: clean(payload.action, 300),
            intent: clean(payload.intent, 240),
            confidence: Math.max(
              0,
              Math.min(100, Math.round(Number(payload.confidence) || 0))
            ),
            urgency: validUrgency(payload.urgency),
            generationMode: "overnight",
            dueAt: clean(payload.dueAt, 80) || null,
            sourceTaskId: task.id,
          });
          return result.created ? "created" : "reused";
        } catch (error) {
          console.error("Overnight email draft failed", task.id, error);
          return "failed";
        }
      })
    );
    created += results.filter((result) => result === "created").length;
    reused += results.filter((result) => result === "reused").length;
    failed += results.filter((result) => result === "failed").length;
  }
  return { queued: tasks.length, created, reused, failed };
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }
  const accounts = await listActiveAccountScopes({ connectedOnly: true });
  const results = [];
  for (const account of accounts) {
    try {
      const result = await runWithServiceRecordScope(account, () =>
        runAccount(account)
      );
      results.push({ userId: account.userId, ok: true, ...result });
    } catch (error: any) {
      results.push({
        userId: account.userId,
        ok: false,
        error: String(error?.message || "Overnight email drafting failed"),
      });
    }
  }
  return NextResponse.json({
    ok: results.every((result) => result.ok),
    accounts: results,
  });
}
