import { NextResponse } from "next/server";
import { getAccessToken, listEvents, meetingUrlOf, titleOf } from "@/lib/google";
import { supabaseAdmin } from "@/lib/supabase";

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
    };
    const rows: Row[] = [];
    for (const ev of events) {
      if (ev.status === "cancelled") continue;
      const self = Array.isArray(ev.attendees)
        ? ev.attendees.find((a: any) => a.self)
        : null;
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

    const toInsert = rows
      .filter((r) => !existing.has(r.external_id))
      .map((r) => ({ ...r, company_id: null, source: "google", prepped: false }));
    const toUpdate = rows.filter((r) => existing.has(r.external_id));

    let added = 0;
    if (toInsert.length) {
      const { data } = await supabaseAdmin
        .from("upcoming_calls")
        .insert(toInsert)
        .select("id");
      added = data?.length || 0;
    }

    // Reschedules: only the calendar-owned fields, never the user's data.
    await Promise.all(
      toUpdate.map((r) =>
        supabaseAdmin
          .from("upcoming_calls")
          .update({
            scheduled_at: r.scheduled_at,
            title: r.title,
            meeting_url: r.meeting_url,
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
