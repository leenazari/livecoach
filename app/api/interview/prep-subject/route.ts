import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  COMPANY_TTL_DAYS,
  PERSON_TTL_DAYS,
  EMPTY_STATE,
  companyState,
  guestFromTitle,
  loadCompany,
  personState,
  resolveContact,
  websiteFromEmail,
} from "@/lib/research-cache";
import { resolveCallScope } from "@/lib/workstreams";
import { resolvePrimaryAttendeeForCall } from "@/lib/call-subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

// PREP SUBJECT.
//
// One read that answers everything the prep chain needs before it spends a
// penny: who this call is with, which company they sit in, what is ALREADY
// researched and how fresh it is, whether there is call history to build an
// intent from, and whether an intent already exists.
//
// It creates nothing and spends nothing. The chain calls this first, shows the
// checklist, and only the steps that are genuinely missing ever run.
//
// GET /api/interview/prep-subject?upcomingId=...&companyId=...

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const upcomingId = sp.get("upcomingId") || "";
    let companyId = sp.get("companyId") || "";

    let call: any = null;
    if (upcomingId) {
      const { data } = await supabaseAdmin
        .from("upcoming_calls")
        .select(
          "id, company_id, workstream_id, title, scheduled_at, meeting_url, intent, prepped, prep, research, attendees"
        )
        .eq("id", upcomingId)
        .maybeSingle();
      call = data || null;
      if (call && call.company_id && !companyId) companyId = call.company_id;
    }

    const company = await loadCompany(companyId || null);
    const scope = await resolveCallScope({
      companyId,
      upcomingId,
      workstreamId: call?.workstream_id,
      attendees: call?.attendees,
    });
    const workstream = scope.workstream;
    if (call && workstream && !call.workstream_id)
      call.workstream_id = workstream.id;

    // ---- Who is on the call -------------------------------------------------
    // Calendar ordering is not meaningful. Resolve the lead person from the
    // title, linked contacts, company domain and unique external guest. If the
    // evidence is ambiguous we leave the person blank rather than borrowing
    // another invitee's relationship history.
    const guest = call ? await resolvePrimaryAttendeeForCall(call) : null;
    const fromTitle = call ? guestFromTitle(call.title || "") : null;

    let person = (guest && guest.name) || (fromTitle && fromTitle.name) || "";
    let personEmail = (guest && guest.email) || "";
    let role = "";

    let contact: any = null;
    if (person || personEmail) {
      contact = await resolveContact({
        companyId: companyId || null,
        name: person,
        email: personEmail,
        create: false,
      });
    }

    // No guest and no title match: if the client has exactly one contact, that
    // is who this is with. More than one and we stay honest and say we do not
    // know, rather than guessing wrong and briefing a stranger.
    if (!person && companyId) {
      const { data: contacts } = await supabaseAdmin
        .from("contacts")
        .select("id, name, role, email, company_id, attributes")
        .eq("company_id", companyId)
        .limit(3);
      if (contacts && contacts.length === 1) {
        contact = contacts[0];
      }
    }

    if (contact) {
      if (!person && contact.name) person = contact.name;
      if (!personEmail && contact.email) personEmail = contact.email;
      if (contact.role) role = contact.role;
    }

    // ---- A website to anchor the company research --------------------------
    const website =
      (company &&
        typeof company.website === "string" &&
        company.website.trim()) ||
      (company &&
      typeof company.domain === "string" &&
      company.domain.trim() &&
      !company.domain.includes("@")
        ? `https://${company.domain.trim().replace(/^https?:\/\//, "")}`
        : "") ||
      websiteFromEmail(personEmail) ||
      "";

    const companyName =
      (company && company.name) ||
      (fromTitle && fromTitle.company) ||
      "";

    // ---- Is there history to build an intent from? -------------------------
    let hasHistory = false;
    if (companyId) {
      let historyQuery = supabaseAdmin
        .from("interview_summaries")
        .select("id")
        .eq("company_id", companyId)
        .limit(1);
      if (workstream) historyQuery = historyQuery.eq("workstream_id", workstream.id);
      const { data: rows } = await historyQuery;
      hasHistory = !!(rows && rows.length);
    }

    // ---- What is already researched ----------------------------------------
    const co = company ? companyState(company) : { ...EMPTY_STATE };
    const pe = contact ? personState(contact) : { ...EMPTY_STATE };

    // The internal team entity hosts many unrelated meetings, so its email
    // thread must never be fed into a specific call's intent or plan.
    const internal = !!(
      company &&
      company.profile &&
      (company.profile as any).internal === true
    );
    let workstreamEmailContext = "";
    if (workstream) {
      const { data: thread } = await supabaseAdmin
        .from("workstreams")
        .select("email_context")
        .eq("id", workstream.id)
        .maybeSingle();
      workstreamEmailContext =
        typeof thread?.email_context === "string" ? thread.email_context : "";
    }
    const emailContext = !internal
      ? workstream
        ? workstreamEmailContext
        : company && typeof company.email_context === "string"
          ? company.email_context
          : ""
      : "";

    return NextResponse.json({
      subject: {
        person,
        personEmail,
        role,
        contactId: contact ? contact.id : null,
        companyId: companyId || null,
        companyName,
        website,
        internal,
        departmentId: workstream?.departmentId || null,
        departmentName: workstream?.departmentName || null,
        workstreamId: workstream?.id || null,
        workstreamName: workstream?.name || null,
      },
      call: call
        ? {
            id: call.id,
            title: call.title || "",
            scheduledAt: call.scheduled_at || null,
            meetingUrl: call.meeting_url || "",
            intent: typeof call.intent === "string" ? call.intent : "",
            prepped: !!call.prepped,
            hasPrep: !!call.prep,
            // The saved prep snapshot itself, so reopening the screen can show
            // the focus and plan you already built and paid for instead of
            // offering to build them again from scratch.
            prep: call.prep && typeof call.prep === "object" ? call.prep : null,
            outreach:
              call.research?.outreach && typeof call.research.outreach === "object"
                ? {
                    source: call.research.outreach.source || "Interviewa outreach",
                    summary: call.research.outreach.research?.summary || "",
                    bestAngle: call.research.outreach.research?.bestAngle || "",
                    signals: Array.isArray(call.research.outreach.research?.signals)
                      ? call.research.outreach.research.signals.slice(0, 3)
                      : [],
                    emailContext:
                      typeof call.research.outreach.emailContext === "string"
                        ? call.research.outreach.emailContext.slice(0, 6000)
                        : "",
                  }
                : null,
          }
        : null,
      hasHistory,
      emailContext,
      company: { ...co, ttlDays: COMPANY_TTL_DAYS },
      person: { ...pe, ttlDays: PERSON_TTL_DAYS },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "could not read the call" },
      { status: 500 }
    );
  }
}
