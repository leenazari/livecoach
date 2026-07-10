import { NextResponse } from "next/server";
import { getAccessToken, listAllEvents, meetingUrlOf, titleOf } from "@/lib/google";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";
import {
  loadAttendeeConfig,
  inferLink,
  deriveNewClientFromAttendees,
} from "@/lib/attendees";

export const runtime = "nodejs";
export const maxDuration = 60;

// When a new event has no work-email guest to derive a client from, read the
// TITLE to decide who the call is with, so a real client call still gets a
// profile created and can be prepped before the first call. One cheap Haiku
// pass for the whole batch. Best-effort: returns nothing on any failure, so the
// sync never breaks on this. Returns input title -> client name (or null).
async function deriveClientsFromTitles(
  titles: string[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const list = titles.filter(Boolean).slice(0, 40);
  if (!list.length) return out;
  try {
    const system = `You file calendar events under a CLIENT. The user runs an AI interview product called "Interviewa" / "Interviewer" - those words always mean THEIR OWN product, never the client, so extract the OTHER party. For each event title, return the external company or client name to file it under, or null. Return null for internal team meetings (standup, sprint, retro, design review, 1:1, board, all hands), for personal or admin events (lunch, coffee, dentist, doctor, holiday, gym, birthday, school run), and for anything where no specific external party can be identified. Prefer a company name over a person's name. If a company is given in parentheses, use that. Return ONLY JSON in the SAME ORDER and SAME COUNT as the input: {"results":[{"client":"<name>" or null}, ...]}.`;
    const user = `Event titles:\n${list
      .map((t, i) => `${i + 1}. ${t}`)
      .join("\n")}\n\nReturn the JSON array now, one entry per title in order.`;
    const msg: any = await anthropic.messages.create({
      model: CLAUDE_MODEL_LIVE,
      max_tokens: 800,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = (Array.isArray(msg?.content) ? msg.content : [])
      .filter((b: any) => b && b.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("");
    const a = text.indexOf("{");
    const z = text.lastIndexOf("}");
    const parsed = a >= 0 && z > a ? JSON.parse(text.slice(a, z + 1)) : {};
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    list.forEach((t, i) => {
      const r = results[i];
      const c =
        r && typeof r.client === "string" && r.client.trim()
          ? r.client.trim()
          : null;
      out.set(t, c);
    });
  } catch {
    /* best-effort: no title-based creation when this fails */
  }
  return out;
}

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
    // Read EVERY calendar the account can see, not just the primary, so a
    // personal calendar shared into the connected account is picked up too.
    const events = await listAllEvents(access, timeMin, timeMax);

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

    // Pass 1: resolve from the guest list, then inherited curation.
    const resolved: {
      r: Row;
      company_id: string | null;
      intent: string | null;
    }[] = [];
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
      resolved.push({ r, company_id, intent });
    }

    // Pass 2: anything still without a client - create one from the TITLE, so a
    // real client call gets a profile the moment it's booked and can be prepped
    // before the first call. Find-or-reuse a company by name to avoid duplicates.
    const unresolvedTitles = Array.from(
      new Set(
        resolved.filter((x) => !x.company_id).map((x) => x.r.title).filter(Boolean)
      )
    );
    if (unresolvedTitles.length) {
      const titleToClient = await deriveClientsFromTitles(unresolvedTitles);
      const nameToCompanyId = new Map<string, string>();
      const ensureCompany = async (name: string): Promise<string | null> => {
        const key = name.toLowerCase();
        if (nameToCompanyId.has(key)) return nameToCompanyId.get(key) || null;
        let id: string | null = null;
        const { data: found } = await supabaseAdmin
          .from("companies")
          .select("id")
          .ilike("name", name)
          .limit(1);
        if (found && found[0]) id = (found[0] as any).id as string;
        if (!id) {
          const { data: created } = await supabaseAdmin
            .from("companies")
            .insert({ name, profile: { auto_created_from: "calendar-title" } })
            .select("id")
            .single();
          id = ((created as any)?.id as string) || null;
        }
        if (id) nameToCompanyId.set(key, id);
        return id;
      };
      for (const x of resolved) {
        if (x.company_id) continue;
        const name = titleToClient.get(x.r.title);
        if (name) x.company_id = await ensureCompany(name);
      }
    }

    // De-dupe id-change duplicates: Google sometimes issues a NEW event id for
    // the SAME meeting, so it arrives as a "new" event and we would insert a
    // second row identical in title + time to one already on the list. Skip a
    // new event whose (title, scheduled_at) already exists (or repeats within
    // this batch). Recurring meetings differ by time, so this never collapses a
    // genuine series.
    const dupKey = (title: string, at: string) =>
      `${String(title || "").toLowerCase().trim()}|${at}`;
    const seenKeys = new Set<string>();
    const { data: liveRows } = await supabaseAdmin
      .from("upcoming_calls")
      .select("title, scheduled_at")
      .is("completed_at", null);
    for (const lr of liveRows || [])
      if ((lr as any).title && (lr as any).scheduled_at)
        seenKeys.add(dupKey((lr as any).title, (lr as any).scheduled_at));

    const toInsert: any[] = [];
    for (const x of resolved) {
      const key = dupKey(x.r.title, x.r.scheduled_at);
      if (seenKeys.has(key)) continue; // duplicate of an existing/just-added row
      seenKeys.add(key);
      toInsert.push({
        external_id: x.r.external_id,
        title: x.r.title,
        scheduled_at: x.r.scheduled_at,
        meeting_url: x.r.meeting_url,
        attendees: x.r.attendees,
        company_id: x.company_id,
        intent: x.intent,
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
