import { NextRequest, NextResponse } from "next/server";

import { emailDomain, outreachCrmGuard, prospectHasBlockedCrmRelationship } from "@/lib/outreach";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";
import { queueApprovedOutreachMessage } from "@/lib/outreach-send-queue";
import {
  isActiveOutreachEnrolmentStatus,
  isInsideCrossCampaignCooldown,
  outreachSafetyError,
} from "@/lib/outreach-team-safety";
import { supabaseAdmin } from "@/lib/supabase";
import { outreachEmailEndsWithDemoReplyCta } from "@/lib/outreach-demo-reply-cta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIMPLE_OPT_OUT = /(not|won't|will not|do not).{0,24}follow up/i;

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

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
      return NextResponse.json(
        { error: "The exact recipient email is required before anything can be sent" },
        { status: 400 }
      );
    }
    if (!subject || !bodyText) {
      return NextResponse.json(
        { error: "The exact subject and email body are required before approval" },
        { status: 400 }
      );
    }
    if (!SIMPLE_OPT_OUT.test(bodyText)) {
      return NextResponse.json(
        { error: "Add a simple do not follow up line before approving this outreach email" },
        { status: 400 }
      );
    }
    if (!outreachEmailEndsWithDemoReplyCta(bodyText)) {
      return NextResponse.json(
        {
          error:
            "End this outreach email by asking them to book a quick demo by replying to this email",
        },
        { status: 400 }
      );
    }
    if (!requestKey) {
      return NextResponse.json(
        { error: "This approved Brain action is missing its retry-safe request key" },
        { status: 400 }
      );
    }

    const finishApprovedMessage = async (message: any, reused: boolean) => {
      if (
        message.message_source !== "brain_direct" ||
        message.recipient_email !== recipientEmail ||
        message.subject !== subject ||
        message.body_text !== bodyText
      ) {
        return NextResponse.json(
          { error: "This approval key was already used for different email content" },
          { status: 409 }
        );
      }
      if (["failed", "cancelled"].includes(message.status)) {
        return NextResponse.json(
          { error: "This earlier approved email was stopped and must be reviewed again" },
          { status: 409 }
        );
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
      return NextResponse.json(
        { error: "This person or company is on the do not contact list" },
        { status: 409 }
      );
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
      return NextResponse.json(
        { error: "This recipient is assigned to another salesperson" },
        { status: 409 }
      );
    }
    if (
      prospect &&
      prospectHasBlockedCrmRelationship(prospect, await outreachCrmGuard())
    ) {
      return NextResponse.json(
        { error: "This CRM relationship is not eligible for cold outreach" },
        { status: 409 }
      );
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
      if ((activeEnrolments || []).some((row: any) => isActiveOutreachEnrolmentStatus(row.status))) {
        return NextResponse.json(
          {
            error:
              "This recipient already has an active outreach campaign. Do you want to use this email there, or pause that campaign before sending it separately?",
            needsInput: true,
            question:
              "Do you want to use the approved email in their existing campaign, or pause that campaign before sending it separately?",
          },
          { status: 409 }
        );
      }
      if (latestSent?.sent_at && isInsideCrossCampaignCooldown(latestSent.sent_at)) {
        return NextResponse.json(
          {
            error:
              "This recipient was emailed within the last 30 days, so the safety pause is still active.",
          },
          { status: 409 }
        );
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
        return NextResponse.json(
          { error: "Another salesperson claimed this recipient first" },
          { status: 409 }
        );
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
    return NextResponse.json(
      { error: safetyMessage || error?.message || "The email could not be queued" },
      { status: safetyMessage ? 409 : 500 }
    );
  }
}
