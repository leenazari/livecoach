import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { notificationActionInput } from "@/lib/notification-actions";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import { isUuid } from "@/lib/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const scope = requireRequestScope();
    if (scope.status !== "active") throw Object.assign(new Error("An active account is required"), { status: 403 });
    if (!isUuid(params.id)) throw Object.assign(new Error("Notification not found"), { status: 404 });
    const parsed = notificationActionInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw Object.assign(new Error(parsed.error.issues[0]?.message || "Check the action details"), { status: 400 });
    const input = parsed.data;
    // The browser cannot supply owner, client, task or deal IDs. The function
    // resolves exact source relationships and commits all effects atomically.
    const { data, error } = await supabaseService.rpc("record_notification_action_service", {
      p_actor: scope.userId, p_workspace: scope.workspaceId, p_notification: params.id,
      p_request: input.requestId, p_mode: input.mode, p_note: input.note,
      p_channel: input.channel, p_complete: input.complete,
      p_next_action: input.nextAction, p_due_at: input.dueAt,
    });
    if (error) {
      const status = ({ "22023": 400, "42501": 403, P0002: 404, "23505": 409 } as Record<string, number>)[error.code] || 500;
      throw Object.assign(new Error(error.message), { status });
    }
    if (data?.ok !== true || !isUuid(data.contextId)) throw new Error("The save was not confirmed");
    return NextResponse.json(data, { headers });
  } catch (error: any) {
    const status = [400, 403, 404, 409].includes(error?.status) ? error.status : 500;
    return NextResponse.json(crmBlockerPayload({
      code: `notification_action_${status}`, title: "Action not saved",
      reason: status === 500 ? "LiveCoach could not confirm this save" : error.message,
      nextAction: "Your note is still here. Try again to check the same save, or open the original record if access has changed. Nothing is sent by logging an action.",
      responsible: "system",
    }), { status, headers });
  }
}
