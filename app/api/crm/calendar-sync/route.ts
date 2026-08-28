import { NextRequest, NextResponse } from "next/server";
import { meetingUrlOf, titleOf } from "@/lib/google";
import { listConnectedCalendarSnapshot } from "@/lib/calendar-provider";
import { supabaseAdmin } from "@/lib/supabase";
import { setAppConfigValue } from "@/lib/app-config";
import { resolveRecordScope } from "@/lib/record-scope";
import { openai, OPENAI_MODEL_LIVE } from "@/lib/openai";
import {
  loadAttendeeConfig,
  inferLink,
  deriveNewClientFromAttendees,
} from "@/lib/attendees";
import {
  attachOutreachMeeting,
  ensureOutreachCompany,
  firstOutreachCallIntent,
  loadOutreachProspectsForAttendees,
  matchOutreachProspectForAttendees,
} from "@/lib/outreach-crm";
import { resolveExistingCompany } from "@/lib/company-resolver";
import {
  isNonMeetingCalendarBlock,
  scheduledCalendarSyncDecision,
} from "@/lib/calendar-events";
import { listActiveAccountScopes } from "@/lib/automation-accounts";
import { runWithServiceRecordScope } from "@/lib/service-scope";

export const runtime = "nodejs";
export const maxDuration = 60;

// When a new event has no work-email guest to derive a client from, read the
// TITLE to decide who the call is with, so a real client call still gets a
// profile created and can be prepped before the first call. One cheap Luna
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
    const msg: any = await openai.messages.create({
      model: OPENAI_MODEL_LIVE,
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

// POST /api/crm/calendar-sync -> pull the user's connected calendar (now to +30d)
// into upcoming_calls. Adds new events, applies reschedules (time/title/link),
// skips cancelled and self-declined events, and never touches the client link,
// intent or prep on an existing row. Supports Google and Microsoft accounts.
async function runCalendarSync() {
  try {
    await resolveRecordScope();
    const now = Date.now();
    const timeMin = new Date(now - 3 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    // Read every calendar the account can see, not just the primary, so a
    // shared calendar is picked up too without crossing account boundaries.
    const snapshot = await listConnectedCalendarSnapshot(timeMin, timeMax);
    if (!snapshot) {
      return NextResponse.json(
        { error: "Connect Google or Microsoft Calendar in Settings first." },
        { status: 400 }
      );
    }
    const source = snapshot.source;
    const events = snapshot.events;

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
      const title = titleOf(ev);
      // Personal reminder blocks remain in the source calendar but never enter the
      // CRM. A complete sync also removes any older matching CRM rows because
      // their event ids are deliberately absent from `liveId` below.
      if (isNonMeetingCalendarBlock(title)) continue;
      rows.push({
        // Preserve existing Google ids. Prefix Microsoft ids so two providers
        // can never collide inside the shared upcoming_calls table.
        external_id: source === "microsoft" ? `microsoft:${ev.id}` : ev.id,
        title,
        scheduled_at: startIso,
        meeting_url: ev.meeting_url || meetingUrlOf(ev),
        attendees: atts,
      });
    }

    // Full reconciliation, not just add/update. Providers omit deleted events
    // from a normal bounded list, so any future calendar-owned row absent from
    // that list is stale and must leave Upcoming Calls. Manual rows are never
    // touched. When only the provider event id changed, relink the matching title +
    // time row so saved client, intent and prep survive.
    const liveId = new Set(rows.map((r) => r.external_id));
    const keyOf = (title: string | null, at: string | null) =>
      `${String(title || "").toLowerCase().trim()}|${at || ""}`;
    const liveByKey = new Map(rows.map((r) => [keyOf(r.title, r.scheduled_at), r]));
    let removed = 0;
    let relinked = 0;
    // An incomplete provider snapshot can still safely add/update events, but it
    // cannot prove an absent event was cancelled. Reconcile only after every
    // eligible calendar returned successfully.
    if (snapshot.complete) {
      const { data: storedCalendarRows, error: storedError } = await supabaseAdmin
        .from("upcoming_calls")
        .select("id, external_id, title, scheduled_at")
        .eq("source", source)
        .is("completed_at", null)
        .gte("scheduled_at", timeMin)
        .lte("scheduled_at", timeMax)
        .limit(1000);
      if (storedError) throw storedError;

      const staleIds: string[] = [];
      const storedLiveIds = new Set(
        (storedCalendarRows || [])
          .map((row: any) => row.external_id as string)
          .filter((id: string) => id && liveId.has(id))
      );
      for (const stored of storedCalendarRows || []) {
        if (stored.external_id && liveId.has(stored.external_id)) continue;
        const replacement = liveByKey.get(keyOf(stored.title, stored.scheduled_at));
        if (replacement && !storedLiveIds.has(replacement.external_id)) {
          const { error } = await supabaseAdmin
            .from("upcoming_calls")
            .update({ external_id: replacement.external_id })
            .eq("id", stored.id);
          if (error) throw error;
          storedLiveIds.add(replacement.external_id);
          relinked += 1;
        } else {
          staleIds.push(stored.id);
        }
      }
      if (staleIds.length) {
        const { data: deleted, error } = await supabaseAdmin
          .from("upcoming_calls")
          .delete()
          .in("id", staleIds)
          .eq("source", source)
          .select("id");
        if (error) throw error;
        removed = deleted?.length || 0;
      }
    }

    // Which of these already exist (so we update vs insert).
    const ids = rows.map((r) => r.external_id);
    const existing = new Set<string>();
    const existingCompany = new Map<string, string | null>();
    const existingId = new Map<string, string>();
    if (ids.length) {
      const { data } = await supabaseAdmin
        .from("upcoming_calls")
        .select("id, external_id, company_id")
        .in("external_id", ids);
      for (const d of data || []) {
        if (!d.external_id) continue;
        existing.add(d.external_id);
        existingId.set(d.external_id, d.id);
        existingCompany.set(d.external_id, d.company_id || null);
      }
    }

    // Imply the client from the GUEST LIST. The invitees are who the call is
    // actually with; an all-internal guest list is a board/strategy call, an
    // outside guest matched to a client links there. Names only mentioned in the
    // note are the topic, not the participant.
    const attendeeConfig = await loadAttendeeConfig();
    // One lookup for the whole calendar snapshot. This keeps the daily repair
    // fast even when there are dozens of existing meetings.
    const outreachByEmail = await loadOutreachProspectsForAttendees(
      rows.map((row) => row.attendees)
    );

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
    // title was already curated, carry the client/internal link onto the new
    // instance. Intents are deliberately NOT inherited: each occurrence needs
    // the latest next-call intent derived from relationship history. This stops
    // daily recurring meetings (standups, design reviews) landing bare each day.
    const inheritTitles = Array.from(
      new Set(newRows.map((r) => r.title).filter(Boolean))
    );
    const curationByTitle = new Map<
      string,
      { company_id: string | null }
    >();
    if (inheritTitles.length) {
      const { data: priors } = await supabaseAdmin
        .from("upcoming_calls")
        .select("title, company_id, created_at")
        .in("title", inheritTitles)
        .order("created_at", { ascending: false });
      for (const p of priors || []) {
        const t = (p as any).title as string;
        if (!t || curationByTitle.has(t)) continue; // most recent wins
        const cid = ((p as any).company_id as string) || null;
        if (cid) curationByTitle.set(t, { company_id: cid });
      }
    }

    // Pass 1: resolve from the guest list, then inherited curation.
    const resolved: {
      r: Row;
      company_id: string | null;
      intent: string | null;
      outreachProspectId: string | null;
    }[] = [];
    for (const r of newRows) {
      const outreachProspect = matchOutreachProspectForAttendees(
        r.attendees,
        outreachByEmail
      );
      const outreachContext = outreachProspect
        ? await ensureOutreachCompany(outreachProspect.id, "booked")
        : null;
      // An exact outreach email is authoritative. When its CRM identity needs
      // review, keep the call unlinked instead of bypassing the review by
      // auto-creating a second company from the same attendee domain.
      let company_id = outreachProspect
        ? outreachContext?.companyId || null
        : await resolveCompanyForEvent(r.attendees);
      let intent: string | null = null;
      if (outreachContext) intent = firstOutreachCallIntent(outreachContext);
      // Only fall back to inherited curation when the guest list gave us
      // nothing - a freshly matched client must never be overwritten.
      if (!company_id) {
        const inh = curationByTitle.get(r.title);
        if (inh) {
          company_id = inh.company_id;
        }
      }
      resolved.push({ r, company_id, intent, outreachProspectId: outreachProspect?.id || null });
    }

    // Pass 2: anything still without a client - create one from the TITLE, so a
    // real client call gets a profile the moment it's booked and can be prepped
    // before the first call. Find-or-reuse a company by name to avoid duplicates.
    const unresolvedTitles = Array.from(
      new Set(
        resolved
          .filter((x) => !x.company_id && !x.outreachProspectId)
          .map((x) => x.r.title)
          .filter((title) => !isNonMeetingCalendarBlock(title))
          .filter(Boolean)
      )
    );
    if (unresolvedTitles.length) {
      const titleToClient = await deriveClientsFromTitles(unresolvedTitles);
      const nameToCompanyId = new Map<string, string>();
      const ensureCompany = async (name: string): Promise<string | null> => {
        const key = name.toLowerCase();
        if (nameToCompanyId.has(key)) return nameToCompanyId.get(key) || null;
        let id: string | null = null;
        const found = await resolveExistingCompany({ name });
        if (found) id = found.id;
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
        if (x.company_id || x.outreachProspectId) continue;
        const name = titleToClient.get(x.r.title);
        if (name) x.company_id = await ensureCompany(name);
      }
    }

    // Reuse the compact next-call memory already produced after the last call.
    // This is a Supabase read, not another AI call.
    const companyIds = Array.from(
      new Set(resolved.map((x) => x.company_id).filter(Boolean) as string[])
    );
    const nextIntentByCompany = new Map<string, string>();
    if (companyIds.length) {
      const { data: companies } = await supabaseAdmin
        .from("companies")
        .select("id, profile")
        .in("id", companyIds);
      for (const company of companies || []) {
        const next = (company as any)?.profile?.next_call?.intent;
        if (typeof next === "string" && next.trim())
          nextIntentByCompany.set((company as any).id, next.trim());
      }
    }

    // De-dupe id-change duplicates: a provider can issue a new event id for
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
        intent:
          (x.company_id && nextIntentByCompany.get(x.company_id)) || x.intent,
        source,
        prepped: false,
      });
    }
    const toUpdate = rows.filter((r) => existing.has(r.external_id));
    const repairedCompany = new Map<string, string>();
    const outreachRepairs: { prospectId: string; upcomingId: string; scheduledAt: string }[] = [];
    for (const r of toUpdate) {
      // Existing calendar rows may pre-date the prospect import/reply. Re-run
      // the free attendee match so the daily sync repairs that handoff too.
      const outreachProspect = matchOutreachProspectForAttendees(
        r.attendees,
        outreachByEmail
      );
      const upcomingId = existingId.get(r.external_id);
      if (outreachProspect && upcomingId) {
        outreachRepairs.push({
          prospectId: outreachProspect.id,
          upcomingId,
          scheduledAt: r.scheduled_at,
        });
        continue;
      }
      if (existingCompany.get(r.external_id)) continue;
      const companyId = await resolveCompanyForEvent(r.attendees);
      if (companyId) repairedCompany.set(r.external_id, companyId);
    }

    let added = 0;
    if (toInsert.length) {
      const { data } = await supabaseAdmin
        .from("upcoming_calls")
        .insert(toInsert)
        .select("id,external_id,scheduled_at");
      added = data?.length || 0;
      const resolvedByExternal = new Map(resolved.map((item) => [item.r.external_id, item]));
      for (const inserted of data || []) {
        const matched = resolvedByExternal.get(inserted.external_id);
        if (!matched?.outreachProspectId) continue;
        try {
          await attachOutreachMeeting(matched.outreachProspectId, inserted.id, inserted.scheduled_at);
        } catch (error) {
          // Calendar truth still lands even if the outreach handoff needs a retry.
          console.error("outreach calendar handoff failed", error);
        }
      }
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
            ...(repairedCompany.has(r.external_id)
              ? { company_id: repairedCompany.get(r.external_id) }
              : {}),
          })
          .eq("external_id", r.external_id)
      )
    );

    let outreachLinked = 0;
    for (const repair of outreachRepairs) {
      try {
        await attachOutreachMeeting(
          repair.prospectId,
          repair.upcomingId,
          repair.scheduledAt
        );
        outreachLinked += 1;
      } catch (error) {
        // The calendar refresh remains successful and tomorrow's sync retries
        // this non-destructive CRM enrichment.
        console.error("existing outreach calendar handoff failed", error);
      }
    }

    const finishedAt = new Date().toISOString();
    const calendarReconnectRequired =
      source === "google" && snapshot.calendarListAccessible === false;
    await setAppConfigValue({
      key: "calendar_sync_last_success_at",
      value: finishedAt,
      note: `Latest successful complete or partial ${source} Calendar refresh`,
    });

    return NextResponse.json({
      ok: true,
      provider: snapshot.provider,
      added,
      updated: toUpdate.length,
      removed,
      relinked,
      reconciled: snapshot.complete,
      calendarReconnectRequired,
      warning: calendarReconnectRequired
        ? "Reconnect Google once to include secondary and shared calendars. The primary calendar was synced safely."
        : null,
      outreachLinked,
      total: rows.length,
      finishedAt,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "calendar sync failed" },
      { status: 500 }
    );
  }
}

// Manual refresh from the Upcoming Calls card.
export async function POST() {
  return runCalendarSync();
}

// Vercel invokes cron paths with GET and sends CRON_SECRET as a bearer token.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }
  const decision = scheduledCalendarSyncDecision();
  if (!decision.run) {
    return NextResponse.json({
      ok: true,
      skipped: `Waiting for the next London sync slot, currently ${decision.weekday} ${String(decision.hour).padStart(2, "0")}:00`,
    });
  }
  const accounts = await listActiveAccountScopes({ connectedOnly: true });
  const results = await Promise.all(accounts.map(async (account) => {
    const response = await runWithServiceRecordScope(account, () => runCalendarSync());
    return { userId: account.userId, status: response.status, result: await response.json() };
  }));
  return NextResponse.json({
    ok: results.every((row) => row.status < 400),
    accounts: results,
  });
}
