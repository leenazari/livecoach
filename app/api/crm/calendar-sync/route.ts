import { NextResponse } from "next/server";
import { getAccessToken, listEvents, meetingUrlOf, titleOf } from "@/lib/google";
import { supabaseAdmin } from "@/lib/supabase";
import {
  loadAttendeeConfig,
  inferLink,
  deriveNewClientFromAttendees,
} from "@/lib/attendees";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/crm/calendar-sync -> pull the user's Google Calendar (now to +30d)
// into upcoming_calls. Adds new events, applies reschedules (time/title/link),
// skips cancelled and self-declined events, and never touches the client link,
// intent or prep on an existing row. Requires a connected Google account.
export async function POST() {
  try {
    const access = await getAccessToken();
    if (!access) {
      return NextResponse.json(
        { error: "Google Calendar isn't connected. Connect it in Settings first." },
        { status: 400 }
      );
    }

    const now = Date.now();
    const timeMin = new Date(now - 3 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    const events = await listEvents(access, timeMin, timeMax);

    type Row = {
      external_id: string;
      title: string;
      scheduled_at: string;
      meeting_url: string | null;
      attendees: any[];
    };
    const rows: Row[] = [];
    for (const ev of events) {
      if (ev.status === "cancelled") continue;
      const atts = Array.isArray(ev.attendees) ? ev.attendees : [];
      const self = atts.find((a: any) => a.self) || null;
      if (self && self.responseStatus === "declined") continue;
      const startIso =
        ev.start?.dateTime ||
        (ev.start?.date ? new Date(`${ev.start.date}T00:00:00Z`).toISOString() : null);
      if (!startIso || !ev.id) continue;
      rows.push({
        external_id: ev.id,
        title: titleOf(ev),
        scheduled_at: startIso,
        meeting_url: meetingUrlOf(ev),
        attendees: atts,
      });
    }

    // Which of these already exist (so we update vs insert).
    const ids = rows.map((r) => r.external_id);
    const existing = new Set<string>();
    if (ids.length) {
      const { data } = await supabaseAdmin
        .from("upcoming_calls")
        .select("external_id")
        .in("external_id", ids);
      for (const d of data || []) if (d.external_id) existing.add(d.external_id);
    }

    // Imply the client from the GUEST LIST. The invitees are who the call is
    // actually with; an all-internal guest list is a board/strategy call, an
    // outside guest matched to a client links there. Names only mentioned in the
    // note are the topic, not the participant.
    const attendeeConfig = await loadAttendeeConfig();

    // Resolve a new event's client: a matched client, the internal entity, or -
    // when the guest list is all we have - a brand-new client created from the
    // guest's WORK email (company name + website from the domain), added as
    // standard so the plan has context from the first invite.
    const resolveCompanyForEvent = async (atts: any[]): Promise<string | null> => {
      const link = inferLink(atts, attendeeConfig);
      if (link.companyId) return link.companyId;
      if (link.isInternal) return null;
      const spec = deriveNewClientFromAttendees(atts, attendeeConfig);
      if (!spec) return null;
      const existingId = attendeeConfig.companyByDomain.get(spec.domain);
      if (existingId) return existingId;
      const { data: created } = await supabaseAdmin
        .from("companies")
        .insert({
          name: spec.name,
          domain: spec.domain,
          website: spec.website,
          profile: { auto_created_from: "calendar" },
        })
        .select("id")
        .single();
      const newId = (created as any)?.id as string | undefined;
      if (!newId) return null;
      attendeeConfig.companyByDomain.set(spec.domain, newId);
      try {
        await supabaseAdmin
          .from("contacts")
          .insert({ company_id: newId, email: spec.email });
      } catch {
        /* the contact is best-effort */
      }
      return newId;
    };

    const newRows = rows.filter((r) => !existing.has(r.external_id));

    // Inherit curation for recurring meetings: if a new event can't resolve a
    // client from its (often empty) guest list, but a PRIOR call with the SAME
    // title was already curated - a client/internal link and/or an intent set by
    // the user or a past sync - carry that onto the new instance. This stops
    // daily recurring meetings (standups, design reviews) landing bare each day.
    const inheritTitles = Array.from(
      new Set(newRows.map((r) => r.title).filter(Boolean))
    );
    const curationByTitle = new Map<
      string,
      { company_id: string | null; intent: string | null }
    >();
    if (inheritTitles.length) {
      const { data: priors } = await supabaseAdmin
        .from("upcoming_calls")
        .select("title, company_id, intent, created_at")
        .in("title", inheritTitles)
        .order("created_at", { ascending: false });
      for (const p of priors || []) {
        const t = (p as any).title as string;
        if (!t || curationByTitle.has(t)) continue; // most recent wins
        const cid = ((p as any).company_id as string) || null;
        const intent = ((p as any).intent as string) || null;
        if (cid || intent) curationByTitle.set(t, { company_id: cid, intent });
      }
    }

    const toInsert: any[] = [];
    for (const r of newRows) {
      let company_id = await resolveCompanyForEvent(r.attendees);
      let intent: string | null = null;
      // Only fall back to inherited curation when the guest list gave us
      // nothing - a freshly matched client must never be overwritten.
      if (!company_id) {
        const inh = curationByTitle.get(r.title);
        if (inh) {
          company_id = inh.company_id;
          intent = inh.intent;
        }
      }
      toInsert.push({
        external_id: r.external_id,
        title: r.title,
        scheduled_at: r.scheduled_at,
        meeting_url: r.meeting_url,
        attendees: r.attendees,
        company_id,
        intent,
        source: "google",
        prepped: false,
      });
    }
    const toUpdate = rows.filter((r) => existing.has(r.external_id));

    let added = 0;
    if (toInsert.length) {
      const { data } = await supabaseAdmin
        .from("upcoming_calls")
        .insert(toInsert)
        .select("id");
      added = data?.length || 0;
    }

    // Reschedules: only the calendar-owned fields (now including the guest list),
    // never the user's own client link, intent or prep.
    await Promise.all(
      toUpdate.map((r) =>
        supabaseAdmin
          .from("upcoming_calls")
          .update({
            scheduled_at: r.scheduled_at,
            title: r.title,
            meeting_url: r.meeting_url,
            attendees: r.attendees,
          })
          .eq("external_id", r.external_id)
      )
    );

    return NextResponse.json({
      ok: true,
      added,
      updated: toUpdate.length,
      total: rows.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "calendar sync failed" },
      { status: 500 }
    );
  }
}
