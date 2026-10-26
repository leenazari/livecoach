import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRecordScope } from "@/lib/record-scope";
import { resolveCallLead } from "@/lib/call-subject";
import { crmBlockerPayload } from "@/lib/crm-blocker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function blocked(status: number, code: string, reason: string, nextAction: string) {
  return NextResponse.json(crmBlockerPayload({ code, title: "Meeting lead not confirmed", reason, nextAction }), { status });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const account = await resolveRecordScope();
    const body = await req.json().catch(() => null);
    const email = typeof body?.leadEmail === "string" ? body.leadEmail.trim().toLowerCase() : "";
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return blocked(400, "meeting_lead_required", "A meeting attendee must be selected", "Choose the lead from the meeting list, then save your choice");
    }
    const { data: call, error } = await supabaseAdmin.from("upcoming_calls")
      .select("id,company_id,workstream_id,title,attendees,intent,prep")
      .eq("id", params.id).eq("workspace_id", account.workspaceId).eq("owner_id", account.userId).maybeSingle();
    if (error) throw error;
    if (!call) return blocked(404, "meeting_lead_unavailable", "This meeting is not available in your account", "Open the meeting from your own Calls list");
    // The same resolver enforces active membership, own-email aliases and
    // supporting internal attendee exclusions for both display and writes.
    const lead = await resolveCallLead(call);
    const selected = lead.leadChoices.find(choice => choice.email === email);
    if (!selected) return blocked(409, "meeting_lead_not_eligible", "That person is not an eligible lead on this invitation. Supporting colleagues cannot replace an external guest", "Refresh the invitation and choose its external lead. For an internal meeting, use an internal-only invitation");
    const oldPrep = call.prep || {};
    const changed = lead.primaryAttendee?.email !== email;
    const manualIntent = oldPrep.intentMeta?.source === "manual";
    const prep = {
      ...oldPrep,
      leadSelection: { ...selected, companyId: call.company_id || null, source: "manual", savedAt: new Date().toISOString() },
      candidate: selected.name,
    };
    if (changed) {
      // Retain human notes/intent, but require a new focus. A previous person's
      // research, email evidence and generated questions must not be carried over.
      Object.assign(prep, {
        suggestedComps: [], selectedComps: [], goals: [], playbook: [],
        pitchKit: null, salesScript: null, openingQuestions: [], planStage: "none",
        focusBasisBrief: "", focusBasisEmailContext: "", callType: "general",
        brief: manualIntent ? call.intent || "" : "",
        intentMeta: manualIntent ? { source: "manual", savedAt: oldPrep.intentMeta.savedAt } : null,
      });
    }
    let update = supabaseAdmin.from("upcoming_calls").update({
      prep,
      ...(changed ? { prepped: false, workstream_id: null, research: null, ...(!manualIntent ? { intent: null } : {}) } : {}),
    }).eq("id", call.id).eq("workspace_id", account.workspaceId).eq("owner_id", account.userId);
    // No lost edits when autosave or calendar sync finishes during selection.
    for (const key of ["company_id", "workstream_id", "intent", "attendees", "prep"] as const) {
      update = call[key] == null ? update.is(key, null)
        : update.eq(key, typeof call[key] === "object" ? JSON.stringify(call[key]) : call[key]);
    }
    const { data: saved, error: saveError } = await update.select("id,prep,intent").maybeSingle();
    if (saveError) throw saveError;
    if (!saved) return blocked(409, "meeting_lead_changed", "The meeting or its preparation changed while you were choosing the lead", "Keep your notes, reopen prep and check the current lead before saving again");
    return NextResponse.json({ ok: true, call: saved, notice: changed && manualIntent
      ? "Lead saved. Your own intent and notes are kept. Review the intent for this person, then rebuild focus."
      : "Lead saved. Matching email context will be used before other history." });
  } catch {
    return blocked(500, "meeting_lead_save_unconfirmed", "LiveCoach could not confirm the meeting lead save", "Keep your notes and reopen prep to check the saved lead before trying again");
  }
}
