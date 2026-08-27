import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { sendConnectedOutreachMail } from "@/lib/mail";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Send the exact prepared body to the signed-in user's own mailbox, never to
// the prospect. This deliberately does not update the message, enrolment,
// prospect, event stream, daily limit or campaign metrics, so a rehearsal
// cannot masquerade as real outreach.
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sender = await resolveOutreachIdentity();
    const { data: message, error: messageError } = await supabaseAdmin
      .from("outreach_messages")
      .select("id,subject,body_text,from_email,sender_user_id,status,prospect_id")
      .eq("workspace_id", sender.workspaceId)
      .eq("sender_user_id", sender.userId)
      .eq("id", params.id)
      .maybeSingle();
    if (messageError || !message)
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    if (message.status === "sent")
      return NextResponse.json(
        { error: "This email has already been sent to the prospect" },
        { status: 400 }
      );
    if (message.from_email !== sender.senderEmail)
      return NextResponse.json(
        { error: "Sender safety check failed" },
        { status: 400 }
      );
    if (!String(message.subject || "").trim() || !String(message.body_text || "").trim())
      return NextResponse.json(
        { error: "Prepare and save the draft before rehearsing it" },
        { status: 400 }
      );

    const { data: prospect } = await supabaseAdmin
      .from("outreach_prospects")
      .select("first_name,last_name,company_name")
      .eq("workspace_id", sender.workspaceId)
      .eq("assigned_to_user_id", sender.userId)
      .eq("id", message.prospect_id)
      .maybeSingle();
    const intendedFor = [
      [prospect?.first_name, prospect?.last_name].filter(Boolean).join(" "),
      prospect?.company_name,
    ]
      .filter(Boolean)
      .join(" at ");
    const rehearsalSubject = `[REHEARSAL${intendedFor ? ` · ${intendedFor}` : ""}] ${message.subject}`;
    const sent = await sendConnectedOutreachMail({
      to: sender.mailboxEmail,
      subject: rehearsalSubject,
      // Keep the body byte-for-byte equivalent to the saved draft so Lee sees
      // the actual prospect experience. Only the subject carries the warning.
      text: message.body_text,
      ownerId: sender.userId,
      senderName: sender.senderName,
      fromEmail: sender.senderEmail,
    });
    if (!sent.ok)
      return NextResponse.json(
        { error: sent.error || "The connected mailbox refused the rehearsal" },
        { status: 502 }
      );

    // Gmail stores a message sent from an account back to that same account as
    // one message. It is commonly visible under Sent or All Mail rather than as
    // a new Inbox delivery. Return that distinction so the UI never tells the
    // user to wait for an Inbox message that Gmail has already accepted.
    const deliveryLocation = sender.provider === "google"
      ? "sent_or_all_mail"
      : "inbox_or_sent";
    console.log(JSON.stringify({
      level: "info",
      msg: "outreach_rehearsal_accepted",
      route: "/api/crm/outreach/messages/[id]/rehearse",
      userId: sender.userId,
      provider: sender.provider,
      messageId: message.id,
      deliveryLocation,
      campaignChanged: false,
    }));

    // Keep a small immutable receipt so Account Readiness can prove this user
    // completed the safe rehearsal without storing another copy of the email.
    // A failed receipt must not turn an already accepted email into a false
    // failure, which could encourage the user to send it twice.
    const { error: receiptError } = await supabaseService
      .from("access_audit_events")
      .insert({
        workspace_id: sender.workspaceId,
        actor_user_id: sender.userId,
        source: "human",
        action: "account_readiness_test_email_completed",
        target_table: "workspace_members",
        target_id: sender.userId,
        metadata: {
          provider: sender.provider,
          message_id: message.id,
          campaign_changed: false,
        },
      });
    if (receiptError) {
      console.error("Outreach rehearsal readiness receipt failed", receiptError.message);
    }

    return NextResponse.json({
      ok: true,
      accepted: true,
      sentTo: sender.mailboxEmail,
      from: sender.senderEmail,
      provider: sender.provider,
      deliveryLocation,
      intendedFor: intendedFor || null,
      campaignChanged: false,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The rehearsal could not be sent" },
      { status: 500 }
    );
  }
}
