import { NextRequest, NextResponse } from "next/server";

import {
  crmBlockerPayload,
  type CrmBlockerInput,
} from "@/lib/crm-blocker";
import { emailDomain, outreachCrmGuard, prospectHasBlockedCrmRelationship } from "@/lib/outreach";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";
import { queueApprovedOutreachMessage } from "@/lib/outreach-send-queue";
import {
  isActiveOutreachEnrolmentStatus,
  isInsideCrossCampaignCooldown,
  outreachSafetyError,
} from "@/lib/outreach-team-safety";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIMPLE_OPT_OUT = /(not|won't|will not|do not).{0,24}follow up/i;

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const blockedResponse = (
  status: number,
  blocker: CrmBlockerInput,
  extra: Record<string, unknown> = {}
) =>
  NextResponse.json(
    { ...crmBlockerPayload(blocker), ...extra },
    { status }
  );

function nameParts(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || null,
    lastName: parts.join(" ") || null,
  };
}

async function ensureApprovedEvent(input: {
  workspaceId: string;
  ownerId: string;
  prospectId: string;
  messageId: string;
}) {
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("outreach_events")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("owner_id", input.ownerId)
    .eq("message_id", input.messageId)
    .eq("kind", "approved")
    .limit(1)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return;
  const { error } = await supabaseAdmin.from("outreach_events").insert({
    workspace_id: input.workspaceId,
    owner_id: input.ownerId,
    visibility: "team",
    campaign_id: null,
    prospect_id: input.prospectId,
    message_id: input.messageId,
    kind: "approved",
    metadata: {
      messageType: "brain_direct",
      source: "brain",
      exactContentConfirmed: true,
    },
  });
  if (error) throw error;
}

export async function POST(req: NextRequest) {
  try {
    const sender = await resolveOutreachIdentity();
    const body = await req.json();
    const recipientEmail = clean(body.email, 320).toLowerCase();
    const recipientName = clean(body.recipientName, 240);
    const company = clean(body.company, 240);
    const subject = clean(body.subject, 160);
    const bodyText = clean(body.body, 4000);
    const requestKey = clean(body.idempotencyKey, 160);

    if (!EMAIL.test(recipientEmail)) {
      return blockedResponse(400, {
        code: "outreach_recipient_email_missing",
        title: "Email approval blocked",
        reason: "The recipient email is missing or invalid",
        nextAction: "Add the exact email address, then approve the email again",
      });
    }
    if (!subject || !bodyText) {
      return blockedResponse(400, {
        code: "outreach_content_missing",
        title: "Email approval blocked",
        reason: "The exact subject or email body is missing",
        nextAction: "Complete both fields, then review and approve the final email",
      });
    }
    if (!SIMPLE_OPT_OUT.test(bodyText)) {
      return blockedResponse(400, {
        code: "outreach_opt_out_missing",
        title: "Email approval blocked",
        reason: "Cold outreach needs a simple do not follow up line",
        nextAction: "Add the opt-out sentence, then approve the revised email",
      });
    }
    if (!requestKey) {
      return blockedResponse(400, {
        code: "outreach_approval_key_missing",
        title: "Email approval blocked",
        reason: "This Brain action is missing the safety key that prevents duplicate sends",
        nextAction: "Create a fresh Brain email action card and approve that version",
        responsible: "system",
      });
    }

    const finishApprovedMessage = async (message: any, reused: boolean) => {
      if (
        message.message_source !== "brain_direct" ||
        message.recipient_email !== recipientEmail ||
        message.subject !== subject ||
        message.body_text !== bodyText
      ) {
        return blockedResponse(409, {
          code: "outreach_approval_key_conflict",
          title: "Email approval blocked",
          reason: "This approval key was already used for different email content",
          nextAction: "Create a fresh action card for the revised email and approve it once",
          responsible: "system",
        });
      }
      if (["failed", "cancelled"].includes(message.status)) {
        return blockedResponse(409, {
          code: "outreach_previous_approval_stopped",
          title: "Email approval blocked",
          reason: "The earlier approved email was stopped or cancelled",
          nextAction: "Open the draft, review the exact content, and approve it again",
        });
      }
      await ensureApprovedEvent({
        workspaceId: sender.workspaceId,
        ownerId: sender.userId,
        prospectId: message.prospect_id,
        messageId: message.id,
      });
      const queued =
        message.status === "approved"
          ? await queueApprovedOutreachMessage(message.id)
          : {
              queued: Boolean(message.scheduled_at),
              scheduledAt: message.scheduled_at,
            };
      const prospectSearch = encodeURIComponent(recipientEmail);
      return NextResponse.json({
        ok: true,
        reused,
        messageId: message.id,
        prospectId: message.prospect_id,
        status: message.status,
        scheduledAt: queued.scheduledAt || null,
        links: {
          outreach: `/crm/outreach?tab=prospects&sort=activity&q=${prospectSearch}`,
          pipeline: "/crm/revenue#recent-outreach",
        },
      });
    };

    const { data: existingMessage, error: existingMessageError } =
      await supabaseAdmin
        .from("outreach_messages")
        .select("id,prospect_id,recipient_email,subject,body_text,status,scheduled_at,message_source")
        .eq("workspace_id", sender.workspaceId)
        .eq("sender_user_id", sender.userId)
        .eq("request_key", requestKey)
        .maybeSingle();
    if (existingMessageError) throw existingMessageError;
    if (existingMessage) {
      return finishApprovedMessage(existingMessage, true);
    }

    const domain = emailDomain(recipientEmail);
    const { data: suppressed, error: suppressionError } = await supabaseAdmin
      .from("outreach_suppressions")
      .select("target")
      .eq("workspace_id", sender.workspaceId)
      .in("target", [recipientEmail, domain]);
    if (suppressionError) throw suppressionError;
    if (suppressed?.length) {
      return blockedResponse(409, {
        code: "outreach_do_not_contact",
        title: "Email blocked",
        reason: "This person or company is on the do-not-contact list",
        nextAction: "Only a workspace owner should remove the suppression after confirmed permission to contact them",
        responsible: "owner",
      });
    }

    const { data: matchedProspect, error: prospectLookupError } =
      await supabaseAdmin
        .from("outreach_prospects")
        .select("*")
        .eq("workspace_id", sender.workspaceId)
        .ilike("email", recipientEmail)
        .maybeSingle();
    if (prospectLookupError) throw prospectLookupError;

    let prospect = matchedProspect;
    if (prospect?.assigned_to_user_id && prospect.assigned_to_user_id !== sender.userId) {
      return blockedResponse(409, {
        code: "outreach_assigned_to_another_salesperson",
        title: "Email blocked",
        reason: "This lead is assigned to another salesperson",
        nextAction: "Ask a manager to reassign the lead before sending",
        responsible: "manager",
      });
    }
    if (
      prospect &&
      prospectHasBlockedCrmRelationship(prospect, await outreachCrmGuard())
    ) {
      return blockedResponse(409, {
        code: "outreach_crm_relationship_ineligible",
        title: "Email blocked",
        reason: "The linked company or matching domain is already engaged, dormant, confidential, or not confirmed as a New lead",
        nextAction: "Open the company record and ask its owner to correct or safely share the sales relationship before sending",
        responsible: "owner",
      });
    }

    if (prospect) {
      const [{ data: activeEnrolments, error: activeError }, { data: latestSent, error: sentError }] =
        await Promise.all([
          supabaseAdmin
            .from("outreach_enrolments")
            .select("id,campaign_id,status,last_sent_at")
            .eq("workspace_id", sender.workspaceId)
            .eq("recipient_email", recipientEmail),
          supabaseAdmin
            .from("outreach_messages")
            .select("id,sent_at")
            .eq("workspace_id", sender.workspaceId)
            .eq("recipient_email", recipientEmail)
            .eq("status", "sent")
            .order("sent_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
      if (activeError) throw activeError;
      if (sentError) throw sentError;
      const blockingEnrolment = (activeEnrolments || []).find((row: any) =>
        isActiveOutreachEnrolmentStatus(row.status)
      );
      if (blockingEnrolment) {
        const paused = blockingEnrolment.status === "paused";
        return blockedResponse(
          409,
          {
            code: paused
              ? "outreach_paused_campaign_enrolment"
              : "outreach_existing_campaign_enrolment",
            title: "Email blocked",
            reason: paused
              ? "This lead is still enrolled in a paused outreach campaign"
              : "This lead is already enrolled in an outreach campaign",
            nextAction: paused
              ? "Open their outreach history and either continue that campaign or ask a manager to remove the paused enrolment before sending separately"
              : "Open their outreach history and continue in the existing campaign, or ask a manager to remove that enrolment before sending separately",
            responsible: paused ? "manager" : "user",
          },
          {
            needsInput: true,
            question: paused
              ? "Do you want to continue the paused campaign, or ask a manager to remove that enrolment before sending separately?"
              : "Do you want to continue in the existing campaign, or ask a manager to remove that enrolment before sending separately?",
          }
        );
      }
      if (latestSent?.sent_at && isInsideCrossCampaignCooldown(latestSent.sent_at)) {
        return blockedResponse(409, {
          code: "outreach_cross_campaign_cooldown",
          title: "Email blocked",
          reason: "This lead was emailed within the last 30 days, so the cross-campaign safety pause is active",
          nextAction: "Wait until the safety window ends, or ask a manager to record an override reason",
          responsible: "manager",
        });
      }
    }

    if (prospect && !prospect.assigned_to_user_id) {
      const { data: claimed, error: claimError } = await supabaseAdmin
        .from("outreach_prospects")
        .update({
          assigned_to_user_id: sender.userId,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", sender.workspaceId)
        .eq("id", prospect.id)
        .is("assigned_to_user_id", null)
        .select("*")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) {
        return blockedResponse(409, {
          code: "outreach_claimed_during_approval",
          title: "Email blocked",
          reason: "Another salesperson claimed this lead while the email was being approved",
          nextAction: "Refresh the lead, check its current owner, and ask a manager to reassign it if needed",
          responsible: "manager",
        });
      }
      prospect = claimed;
    }

    if (!prospect) {
      const person = nameParts(recipientName);
      const { data: created, error: createError } = await supabaseAdmin
        .from("outreach_prospects")
        .insert({
          workspace_id: sender.workspaceId,
          owner_id: sender.userId,
          visibility: "team",
          assigned_to_user_id: sender.userId,
          email: recipientEmail,
          first_name: person.firstName,
          last_name: person.lastName,
          company_name: company || recipientName || domain,
          company_domain: domain || null,
          status: "imported",
          source_file: "Brain direct email",
          public_profile: company
            ? "Added from a separately confirmed one-off Brain email"
            : "Added from Brain. Company details need enrichment if this becomes an active relationship.",
        })
        .select("*")
        .single();
      if (createError) throw createError;
      prospect = created;
    }

    const now = new Date().toISOString();
    const { data: insertedMessage, error: messageError } = await supabaseAdmin
      .from("outreach_messages")
      .insert({
        workspace_id: sender.workspaceId,
        owner_id: sender.userId,
        visibility: "team",
        sender_user_id: sender.userId,
        prospect_id: prospect.id,
        campaign_id: null,
        enrolment_id: null,
        message_source: "brain_direct",
        request_key: requestKey,
        step_number: 1,
        variant: "A",
        from_email: sender.senderEmail,
        recipient_email: recipientEmail,
        subject,
        body_text: bodyText,
        status: "approved",
        approved_at: now,
        strategy: {
          messageType: "brain_direct",
          source: "brain",
          campaignRequired: false,
        },
      })
      .select("*")
      .single();
    let message = insertedMessage;
    if (messageError) {
      if (String(messageError.code || "") !== "23505") throw messageError;
      const { data: racedMessage, error: racedError } = await supabaseAdmin
        .from("outreach_messages")
        .select("*")
        .eq("workspace_id", sender.workspaceId)
        .eq("sender_user_id", sender.userId)
        .eq("request_key", requestKey)
        .maybeSingle();
      if (racedError) throw racedError;
      if (!racedMessage) throw messageError;
      message = racedMessage;
    }
    return finishApprovedMessage(message, Boolean(messageError));
  } catch (error: any) {
    const safetyMessage = outreachSafetyError(error);
    if (safetyMessage) {
      return blockedResponse(409, {
        code: "outreach_safety_rule",
        title: "Email blocked",
        reason: safetyMessage,
        nextAction: "Open the lead's outreach history to resolve the named conflict before trying again",
      });
    }
    console.error(
      JSON.stringify({
        level: "error",
        message: "Brain outreach approval failed",
        requestId: req.headers.get("x-vercel-id"),
        error: error?.message || String(error),
      })
    );
    return blockedResponse(500, {
      code: "outreach_queue_confirmation_failed",
      title: "Email not queued",
      reason: "The CRM could not safely confirm the send request",
      nextAction: "Refresh the outreach record and try once more. If it fails again, send this blocker to a workspace owner",
      responsible: "system",
    });
  }
}
