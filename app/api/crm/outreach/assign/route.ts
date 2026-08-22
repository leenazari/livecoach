import { NextRequest, NextResponse } from "next/server";
import {
  isUntouchedOutreachAssignment,
} from "@/lib/outreach-assignment";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BULK_ASSIGNMENT = 1000;
const QUERY_BATCH_SIZE = 100;

function batches<T>(items: T[], size = QUERY_BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const account = requireRequestScope();
    if (account.role !== "owner" && account.role !== "manager") {
      return NextResponse.json(
        { error: "Only a workspace owner or manager can assign prospects in bulk" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const assignedToUserId = String(body.assignedToUserId || "").trim();
    const suppliedIds = Array.isArray(body.prospectIds) ? body.prospectIds : [];
    const prospectIds: string[] = Array.from(
      new Set<string>(
        suppliedIds.map((value: unknown) => String(value || "").trim())
      )
    );

    if (!UUID.test(assignedToUserId)) {
      return NextResponse.json(
        { error: "Choose an active team member" },
        { status: 400 }
      );
    }
    if (
      !prospectIds.length ||
      prospectIds.length > MAX_BULK_ASSIGNMENT ||
      prospectIds.some((id) => !UUID.test(id))
    ) {
      return NextResponse.json(
        { error: `Choose between 1 and ${MAX_BULK_ASSIGNMENT} valid prospects` },
        { status: 400 }
      );
    }

    const { data: assignee, error: assigneeError } = await supabaseService
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", account.workspaceId)
      .eq("user_id", assignedToUserId)
      .eq("status", "active")
      .maybeSingle();
    if (assigneeError) throw assigneeError;
    if (!assignee) {
      return NextResponse.json(
        { error: "Choose an active member of this workspace" },
        { status: 400 }
      );
    }

    const prospectRows: any[] = [];
    const messageProspectIds = new Set<string>();
    const enrolmentProspectIds = new Set<string>();

    // Small batches avoid oversized PostgREST URLs. Every read still runs as
    // the signed-in user, so workspace RLS remains the final authority.
    for (const idBatch of batches(prospectIds)) {
      const [prospectsResult, messagesResult, enrolmentsResult] =
        await Promise.all([
          supabaseAdmin
            .from("outreach_prospects")
            .select(
              "id,status,assigned_to_user_id,research,last_researched_at,last_contacted_at,last_reply_at"
            )
            .in("id", idBatch),
          supabaseAdmin
            .from("outreach_messages")
            .select("prospect_id")
            .in("prospect_id", idBatch),
          supabaseAdmin
            .from("outreach_enrolments")
            .select("prospect_id")
            .in("prospect_id", idBatch),
        ]);
      if (prospectsResult.error) throw prospectsResult.error;
      if (messagesResult.error) throw messagesResult.error;
      if (enrolmentsResult.error) throw enrolmentsResult.error;
      prospectRows.push(...(prospectsResult.data || []));
      for (const row of messagesResult.data || []) {
        messageProspectIds.add(row.prospect_id);
      }
      for (const row of enrolmentsResult.data || []) {
        enrolmentProspectIds.add(row.prospect_id);
      }
    }

    const visibleIds = new Set(prospectRows.map((row) => row.id));
    const eligibleIds = prospectRows
      .filter(
        (row) =>
          row.assigned_to_user_id !== assignedToUserId &&
          isUntouchedOutreachAssignment(row, {
            hasMessage: messageProspectIds.has(row.id),
            hasEnrolment: enrolmentProspectIds.has(row.id),
          })
      )
      .map((row) => row.id);

    const assignedIds: string[] = [];
    const now = new Date().toISOString();
    for (const idBatch of batches(eligibleIds)) {
      const { data, error } = await supabaseAdmin
        .from("outreach_prospects")
        .update({
          assigned_to_user_id: assignedToUserId,
          updated_at: now,
        })
        .in("id", idBatch)
        .select("id,assigned_to_user_id");
      if (error) throw error;
      assignedIds.push(
        ...(data || [])
          .filter((row) => row.assigned_to_user_id === assignedToUserId)
          .map((row) => row.id)
      );
    }

    return NextResponse.json({
      requested: prospectIds.length,
      assigned: assignedIds.length,
      skipped: prospectIds.length - assignedIds.length,
      hiddenOrUnavailable: prospectIds.filter((id) => !visibleIds.has(id)).length,
      assignedIds,
      rule:
        "Only untouched imported prospects with no research, enrolment, draft, send, contact or reply history were assigned",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "The prospects could not be assigned" },
      { status: 500 }
    );
  }
}
