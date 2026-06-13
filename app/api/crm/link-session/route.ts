import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Link a call to a company/contact by stamping company_id/contact_id onto the
// interview_sessions row for this session_id. Best-effort and idempotent: if the
// session row doesn't exist yet (call not gone live), it simply updates nothing
// and the client can call again later. Pass companyId: null to unlink.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }
    const companyId =
      typeof body.companyId === "string" && body.companyId ? body.companyId : null;
    const contactId =
      typeof body.contactId === "string" && body.contactId ? body.contactId : null;

    const { error } = await supabaseAdmin
      .from("interview_sessions")
      .update({ company_id: companyId, contact_id: contactId })
      .eq("session_id", sessionId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to link session" },
      { status: 500 }
    );
  }
}
