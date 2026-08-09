import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendOutreachMail, OUTREACH_FROM_EMAIL } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REHEARSAL_RECIPIENT = "lee@ai13.com";

// Send the exact prepared body to Lee, never to the prospect. This deliberately
// does not update the message, enrolment, prospect, event stream, daily limit or
// campaign metrics, so a rehearsal cannot masquerade as real outreach.
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { data: message, error: messageError } = await supabaseAdmin
      .from("outreach_messages")
      .select("id,subject,body_text,from_email,status,prospect_id")
      .eq("id", params.id)
      .single();
    if (messageError || !message)
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    if (message.status === "sent")
      return NextResponse.json(
        { error: "This email has already been sent to the prospect" },
        { status: 400 }
      );
    if (message.from_email !== OUTREACH_FROM_EMAIL)
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
    const sent = await sendOutreachMail({
      to: REHEARSAL_RECIPIENT,
      subject: rehearsalSubject,
      // Keep the body byte-for-byte equivalent to the saved draft so Lee sees
      // the actual prospect experience. Only the subject carries the warning.
      text: message.body_text,
    });
    if (!sent.ok)
      return NextResponse.json(
        { error: sent.error || "Gmail refused the rehearsal" },
        { status: 502 }
      );

    return NextResponse.json({
      ok: true,
      sentTo: REHEARSAL_RECIPIENT,
      from: OUTREACH_FROM_EMAIL,
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
