import { NextRequest, NextResponse } from "next/server";
import {
  isUntouchedOutreachAssignment,
} from "@/lib/outreach-assignment";
import { assignOutreachProspectsWithCompanyAccess } from "@/lib/outreach-assignment-service";
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

const normaliseEmail = (value: unknown) =>
  String(value || "").trim().toLowerCase();

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
    const messageRecipientEmails = new Set<string>();
    const enrolmentsByProspect = new Map<string, any[]>();

    // Small batches avoid oversized PostgREST URLs. Every read still runs as
    // the signed-in user, so workspace RLS remains the final authority.
    for (const idBatch of batches(prospectIds)) {
      const [prospectsResult, messagesResult, enrolmentsResult] =
        await Promise.all([
          supabaseAdmin
            .from("outreach_prospects")
            .select(
              "id,email,status,assigned_to_user_id,research,last_researched_at,last_contacted_at,last_reply_at"
            )
            .eq("workspace_id", account.workspaceId)
            .in("id", idBatch),
          supabaseAdmin
            .from("outreach_messages")
            .select("prospect_id,recipient_email,status")
            .eq("workspace_id", account.workspaceId)
            .in("prospect_id", idBatch),
          supabaseAdmin
            .from("outreach_enrolments")
            .select(
              "prospect_id,status,current_step,queued_for,next_action_at,research,research_sources,researched_at,last_sent_at,replied_at,booked_at"
            )
            .eq("workspace_id", account.workspaceId)
            .in("prospect_id", idBatch),
        ]);
      if (prospectsResult.error) throw prospectsResult.error;
      if (messagesResult.error) throw messagesResult.error;
      if (enrolmentsResult.error) throw enrolmentsResult.error;
      prospectRows.push(...(prospectsResult.data || []));
      for (const row of messagesResult.data || []) {
        messageProspectIds.add(row.prospect_id);
        const recipientEmail = normaliseEmail(row.recipient_email);
        if (recipientEmail) messageRecipientEmails.add(recipientEmail);
      }
      for (const row of enrolmentsResult.data || []) {
        const current = enrolmentsByProspect.get(row.prospect_id) || [];
        current.push(row);
        enrolmentsByProspect.set(row.prospect_id, current);
      }
    }

    // A duplicate import row must not bypass permanent email history. Search
    // by the canonical recipient address as well as the selected prospect ID.
    const selectedEmails = Array.from(
      new Set(
        prospectRows
          .map((row) => normaliseEmail(row.email))
          .filter(Boolean)
      )
    );
    for (const emailBatch of batches(selectedEmails)) {
      const { data, error } = await supabaseAdmin
        .from("outreach_messages")
        .select("recipient_email")
        .eq("workspace_id", account.workspaceId)
        .in("recipient_email", emailBatch);
      if (error) throw error;
      for (const row of data || []) {
        const recipientEmail = normaliseEmail(row.recipient_email);
        if (recipientEmail) messageRecipientEmails.add(recipientEmail);
      }
    }

    const visibleIds = new Set(prospectRows.map((row) => row.id));
    const eligibleIds = prospectRows
      .filter(
        (row) =>
          row.assigned_to_user_id !== assignedToUserId &&
          Boolean(normaliseEmail(row.email)) &&
          isUntouchedOutreachAssignment(row, {
            hasMessage: messageProspectIds.has(row.id),
            hasRecipientMessage: messageRecipientEmails.has(
              normaliseEmail(row.email)
            ),
            enrolments: enrolmentsByProspect.get(row.id) || [],
          })
      )
      .map((row) => row.id);

    const assignedIds: string[] = [];
    let companyAccessShared = 0;
    let linkedCompaniesHeldPrivate = 0;
    for (const idBatch of batches(eligibleIds)) {
      const saved = await assignOutreachProspectsWithCompanyAccess({
        actorUserId: account.userId,
        workspaceId: account.workspaceId,
        prospectIds: idBatch,
        assignedToUserId,
      });
      assignedIds.push(...saved.assignedIds);
      companyAccessShared += saved.companyAccessShared;
      linkedCompaniesHeldPrivate += saved.linkedCompaniesHeldPrivate;
    }

    return NextResponse.json({
      requested: prospectIds.length,
      assigned: assignedIds.length,
      skipped: prospectIds.length - assignedIds.length,
      hiddenOrUnavailable: prospectIds.filter((id) => !visibleIds.has(id)).length,
      assignedIds,
      companyAccessShared,
      linkedCompaniesHeldPrivate,
      rule:
        "Only untouched imported prospects were assigned. Eligible New-lead companies received restricted sales access. Private CRM notes and protected relationships did not move. Matching email history anywhere in the workspace always blocks assignment.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "The prospects could not be assigned" },
      { status: 500 }
    );
  }
}
