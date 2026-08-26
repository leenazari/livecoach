import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
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
      .eq("id", params.id)
      .single();
    if (messageError || !message)
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    if (message.status === "sent")
      return NextResponse.json(
        { error: "This email has already been sent to the prospect" },
        { status: 400 }
      );
    if (message.sender_user_id !== sender.userId || message.from_email !== sender.senderEmail)
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
      .eq("id", message.prospect_id)
      .single();
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
