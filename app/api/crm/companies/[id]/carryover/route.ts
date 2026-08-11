import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CALL CARRY-OVER. Everything a recurring call needs to pick up where the last
// one left off, so a brainstorm or standup never starts from a blank slate:
// - the last call's recap (what happened, what each side is doing next),
// - the open items carried forward from the AI summaries (the evolving list),
// - a STANDING CHECKLIST the user maintains by hand and reuses every time.
// Read on the call screen when a client is linked.

const arr = (v: any): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];

const normal = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// A company can contain several unrelated relationships. For a scheduled call,
// use the external attendee identity to keep another contact's recap out of the
// room. Short initials are ignored, while an email local part such as j.singh
// contributes both "j singh" and the distinctive surname "singh".
const attendeeIdentities = (attendees: any): string[] => {
  const values = new Set<string>();
  for (const attendee of Array.isArray(attendees) ? attendees : []) {
    if (!attendee || attendee.self) continue;
    const email = normal(String(attendee.email || "").split("@")[0]);
    const display = normal(attendee.displayName || attendee.name || "");
    for (const value of [display, email]) {
      if (value.length >= 4) values.add(value);
      const words = value.split(" ").filter(Boolean);
      const last = words[words.length - 1] || "";
      if (last.length >= 4) values.add(last);
    }
  }
  return [...values];
};

const summaryMatches = (row: any, identities: string[]) => {
  if (!identities.length) return true;
  const summary = row?.summary && typeof row.summary === "object" ? row.summary : {};
  const haystack = ` ${normal([
    row?.candidate,
    summary?.title,
    summary?.headline,
    summary?.overview,
    JSON.stringify(summary?.myNextActions || []),
    JSON.stringify(summary?.theirNextActions || []),
  ].join(" "))} `;
  return identities.some((identity) => haystack.includes(` ${identity} `));
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const companyId = params.id;
    const upcomingId = req.nextUrl.searchParams.get("upcoming") || "";
    const validUpcomingId = /^[0-9a-f-]{36}$/i.test(upcomingId)
      ? upcomingId
      : "";
    const [
      { data: company },
      { data: sumRows },
      { data: taskRows },
      { data: upcoming },
    ] =
      await Promise.all([
        supabaseAdmin
          .from("companies")
          .select("profile")
          .eq("id", companyId)
          .maybeSingle(),
        supabaseAdmin
          .from("interview_summaries")
          .select("candidate, summary, created_at, workstream_id")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(12),
        supabaseAdmin
          .from("tasks")
          .select("text, kind, status, created_at, workstream_id")
          .eq("company_id", companyId)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(30),
        validUpcomingId
          ? supabaseAdmin
              .from("upcoming_calls")
              .select("company_id, workstream_id, attendees")
              .eq("id", validUpcomingId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

    const profile = (company?.profile || {}) as any;
    const checklist = arr(profile.checklist);

    const identities =
      upcoming?.company_id === companyId
        ? attendeeIdentities(upcoming.attendees)
        : [];
    const personSpecific = identities.length > 0;
    const exactWorkstreamId =
      upcoming?.company_id === companyId ? upcoming?.workstream_id || null : null;
    const row = (sumRows || []).find((item: any) =>
      exactWorkstreamId
        ? item.workstream_id === exactWorkstreamId
        : summaryMatches(item, identities)
    ) as any;
    const s = row?.summary || {};
    const lastCall = row
      ? {
          date: row.created_at || null,
          headline: typeof s.headline === "string" ? s.headline : "",
          overview: typeof s.overview === "string" ? s.overview : "",
          myNextActions: arr(s.myNextActions).slice(0, 6),
          theirNextActions: arr(s.theirNextActions).slice(0, 6),
        }
      : null;

    // The carried, evolving checklist: open next-step / commitment / manual
    // tasks (skip the derived "prep" items and draft emails - those aren't the
    // conversation's own open threads).
    const rowTime = row?.created_at ? new Date(row.created_at).getTime() : 0;
    const openItems = (taskRows || [])
      .filter((t: any) => ["next_step", "commitment", "manual"].includes(t.kind))
      .filter((t: any) => {
        if (exactWorkstreamId) return t.workstream_id === exactWorkstreamId;
        if (!personSpecific) return true;
        if (!row) return false;
        const text = ` ${normal(t.text)} `;
        if (identities.some((identity) => text.includes(` ${identity} `)))
          return true;
        const created = t.created_at ? new Date(t.created_at).getTime() : 0;
        return created >= rowTime - 60_000 && created <= rowTime + 15 * 60_000;
      })
      .map((t: any) => (typeof t.text === "string" ? t.text.trim() : ""))
      .filter(Boolean)
      .slice(0, 12);

    return NextResponse.json({
      lastCall,
      // A standing checklist is currently company-wide. Do not show it on a
      // named-attendee call where it could belong to a different relationship.
      checklist: personSpecific || exactWorkstreamId ? [] : checklist,
      openItems,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load carry-over" },
      { status: 500 }
    );
  }
}

// PUT { checklist: string[] } -> save the STANDING checklist onto the client
// (profile.checklist), preserving the rest of the profile. This is the list the
// user maintains and reuses across the recurring series.
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const checklist = arr(body.checklist)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 50);

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("profile")
      .eq("id", params.id)
      .maybeSingle();
    const profile = (company?.profile || {}) as any;

    const { data: saved, error } = await supabaseAdmin
      .from("companies")
      .update({ profile: { ...profile, checklist } })
      .eq("id", params.id)
      .select("profile")
      .maybeSingle();
    if (error) throw error;
    if (!saved)
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    const confirmed = arr((saved.profile as any)?.checklist);
    return NextResponse.json({ ok: true, checklist: confirmed });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to save the checklist" },
      { status: 500 }
    );
  }
}
