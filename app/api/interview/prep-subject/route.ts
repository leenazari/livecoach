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
  pickGuest,
  resolveContact,
  websiteFromEmail,
} from "@/lib/research-cache";

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
          "id, company_id, title, scheduled_at, meeting_url, intent, prepped, prep, research, attendees"
        )
        .eq("id", upcomingId)
        .maybeSingle();
      call = data || null;
      if (call && call.company_id && !companyId) companyId = call.company_id;
    }

    const company = await loadCompany(companyId || null);

    // ---- Who is on the call -------------------------------------------------
    // The invite's guest list is the most reliable signal, then the title, then
    // the client's own contact list.
    const guest = call ? pickGuest(call.attendees) : null;
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
      const { data: rows } = await supabaseAdmin
        .from("interview_summaries")
        .select("id")
        .eq("company_id", companyId)
        .limit(1);
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
    const emailContext =
      !internal && company && typeof company.email_context === "string"
        ? company.email_context
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
