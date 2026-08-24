import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { ensureWorkspaceProfileId } from "@/lib/workspace-profile";
import { inferLink, loadAttendeeConfig } from "@/lib/attendees";
import { getWorkstreamScope, resolveCallScope } from "@/lib/workstreams";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";

// GET /api/crm/upcoming/:id -> one scheduled call, including any saved prep plan
// (the prep jsonb), plus the linked company name. Lets the call screen reload a
// plan that was built in advance, instead of starting from a blank slate.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from("upcoming_calls")
      .select(
        "id, company_id, workstream_id, title, scheduled_at, meeting_url, intent, prepped, prep, research, attendees"
      )
      .eq("id", params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Repair older calendar rows that have a guest but were never linked to a
    // client. Exact saved contact-email matches are conservative and give Prep
    // access to the correct relationship history immediately.
    if (!data.company_id && Array.isArray(data.attendees)) {
      const config = await loadAttendeeConfig();
      const link = inferLink(data.attendees, config);
      let repairedCompanyId = link.companyId;
      // Legacy calls did not always create a contact. In that case, a unique
      // prior linked summary for the same named attendee is the next strongest
      // signal. Never guess if that person appears under multiple clients.
      if (!repairedCompanyId) {
        const names = data.attendees
          .filter((a: any) => a && !a.self)
          .map((a: any) => {
            const display = String(a.displayName || "").trim();
            if (display) return display;
            return String(a.email || "")
              .split("@")[0]
              .replace(/[._+-]+/g, " ")
              .trim();
          })
          .filter(Boolean)
          .slice(0, 3);
        for (const name of names) {
          const { data: history } = await supabaseAdmin
            .from("interview_summaries")
            .select("company_id")
            .ilike("candidate", name)
            .not("company_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(10);
          // Rows are newest first. The most recent linked call is the best home
          // for this recurring relationship when legacy data was split across
          // several auto-created calendar-title records.
          if (history?.[0]?.company_id) {
            repairedCompanyId = history[0].company_id;
            break;
          }
        }
      }
      if (repairedCompanyId) {
        data.company_id = repairedCompanyId;
        await supabaseAdmin
          .from("upcoming_calls")
          .update({ company_id: repairedCompanyId })
          .eq("id", params.id)
          .is("company_id", null);
      }
    }
    let company: string | null = null;
    if (data.company_id) {
      const { data: co } = await supabaseAdmin
        .from("companies")
        .select("name")
        .eq("id", data.company_id)
        .maybeSingle();
      company = co?.name || null;
    }
    const scope = await resolveCallScope({
      companyId: data.company_id,
      upcomingId: data.id,
      workstreamId: data.workstream_id,
      attendees: data.attendees,
    });
    if (scope.workstream && !data.workstream_id)
      data.workstream_id = scope.workstream.id;
    let workstreamChoices: {
      id: string;
      name: string;
      purpose: string;
      departmentName: string | null;
    }[] = [];
    if (data.company_id) {
      const [{ data: threads }, { data: departments }] = await Promise.all([
        supabaseAdmin
          .from("workstreams")
          .select("id, department_id, name, purpose")
          .eq("company_id", data.company_id)
          .eq("status", "active")
          .order("name", { ascending: true }),
        supabaseAdmin
          .from("departments")
          .select("id, name")
          .eq("company_id", data.company_id),
      ]);
      const departmentNames = new Map(
        (departments || []).map((department: any) => [
          department.id,
          department.name,
        ])
      );
      workstreamChoices = (threads || []).map((thread: any) => ({
        id: thread.id,
        name: thread.name,
        purpose: thread.purpose || "",
        departmentName: thread.department_id
          ? departmentNames.get(thread.department_id) || null
          : null,
      }));
    }
    return NextResponse.json({
      call: {
        ...data,
        company,
        workstream: scope.workstream,
        workstreamChoices,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load the call" },
      { status: 500 }
    );
  }
}

// PATCH /api/crm/upcoming/:id -> update a scheduled call (mark prepped, edit the
// intent, time, link, client, or store the prep plan). Only provided fields are
// touched.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const patch: Record<string, any> = {};
    let current: any = null;
    if ("intent" in body || "prep" in body || body.completed === true) {
      const { data, error } = await supabaseAdmin
        .from("upcoming_calls")
        .select("intent, prep, scheduled_at, completed_at")
        .eq("id", params.id)
        .maybeSingle();
      if (error) throw error;
      current = data;
    }
    const currentPrep =
      current?.prep && typeof current.prep === "object" ? current.prep : {};
    const currentIntentMeta = (currentPrep as any).intentMeta;
    // An open browser tab may still autosave an older generated snapshot. Once
    // the user has manually corrected the intent, that stale snapshot must not
    // overwrite either the canonical intent or the prep brief.
    const protectManualIntent =
      currentIntentMeta?.source === "manual" && body.intentSource !== "manual";
    const canonicalIntent = String(current?.intent || "").trim();
    const incomingFocusBasis =
      body.prep && typeof body.prep === "object" &&
      typeof body.prep.focusBasisBrief === "string"
        ? body.prep.focusBasisBrief.trim()
        : "";
    const staleFocusSnapshot =
      protectManualIntent &&
      Boolean(canonicalIntent) &&
      incomingFocusBasis !== canonicalIntent;
    if (typeof body.title === "string") patch.title = body.title.trim() || null;
    if ("scheduledAt" in body) patch.scheduled_at = body.scheduledAt || null;
    if (typeof body.meetingUrl === "string")
      patch.meeting_url = body.meetingUrl.trim() || null;
    if (typeof body.intent === "string")
      patch.intent = protectManualIntent
        ? current?.intent || null
        : body.intent.trim() || null;
    if (
      typeof body.intent === "string" &&
      (body.intentSource === "manual" || body.intentSource === "generated")
    ) {
      const prep = currentPrep;
      patch.prep = {
        ...prep,
        intentMeta: {
          ...(prep as any).intentMeta,
          source: body.intentSource,
          savedAt: new Date().toISOString(),
        },
      };
    }
    if (typeof body.prepped === "boolean")
      patch.prepped = staleFocusSnapshot ? false : body.prepped;
    // Mark a call done (it happened) or re-open it. Clears it from the upcoming
    // list and the derived prep to-dos without deleting the row.
    if (body.completed === true && current?.scheduled_at) {
      const scheduledMs = new Date(current.scheduled_at).getTime();
      const earliestCompletionMs = Date.now() + 15 * 60 * 1000;
      if (Number.isFinite(scheduledMs) && scheduledMs > earliestCompletionMs) {
        return NextResponse.json(
          {
            error:
              "This meeting has not started yet. It is still in Upcoming Calls.",
          },
          { status: 409 }
        );
      }
    }
    if (typeof body.completed === "boolean")
      patch.completed_at = body.completed ? new Date().toISOString() : null;
    // The prep plan snapshot (focus, goals, opening questions, etc.) built in
    // advance on the call screen, so it survives leaving the page.
    if ("prep" in body) {
      if (body.prep && typeof body.prep === "object") {
        const intentMeta =
          patch.prep?.intentMeta ||
          currentIntentMeta || null;
        patch.prep = {
          ...body.prep,
          ...(protectManualIntent && current?.intent
            ? { brief: current.intent }
            : {}),
          ...(staleFocusSnapshot
            ? {
                callType: "general",
                suggestedComps: [],
                selectedComps: [],
                goals: [],
                playbook: [],
                pitchKit: null,
                salesScript: null,
                privateNotes: [],
                openingQuestions: [],
                planStage: "none",
                focusBasisBrief: "",
              }
            : {}),
          ...(intentMeta ? { intentMeta } : {}),
        };
      } else {
        patch.prep = body.prep ?? null;
      }
    }
    if ("companyId" in body)
      patch.company_id =
        typeof body.companyId === "string" && body.companyId
          ? body.companyId
          : null;
    if ("workstreamId" in body) {
      const workstream = await getWorkstreamScope(body.workstreamId);
      if (workstream) {
        if (patch.company_id && patch.company_id !== workstream.companyId)
          return NextResponse.json(
            { error: "workstream does not belong to this company" },
            { status: 409 }
          );
        patch.company_id = workstream.companyId;
        patch.workstream_id = workstream.id;
      } else if (body.workstreamId == null || body.workstreamId === "") {
        patch.workstream_id = null;
      } else {
        return NextResponse.json(
          { error: "workstream not found" },
          { status: 404 }
        );
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true });
    }
    const { data, error } = await supabaseAdmin
      .from("upcoming_calls")
      .update(patch)
      .eq("id", params.id)
      .select("id, title, scheduled_at, meeting_url, intent, prepped, completed_at, company_id, workstream_id, prep")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json({ error: "call not found" }, { status: 404 });
    return NextResponse.json({ ok: true, call: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to update" },
      { status: 500 }
    );
  }
}

// POST /api/crm/upcoming/:id/cancel -> the call is OFF (cancelled, or it happened
// separately). Note the reason in the brain's memory so it is remembered, then
// remove the scheduled call - which drops it off the upcoming list AND its
// derived prep to-do at once. The calendar sync won't re-add it because the
// event is no longer on the calendar.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const profileId = await ensureWorkspaceProfileId();
    const body = await req.json().catch(() => ({}));
    const reason =
      body && typeof body.reason === "string" ? body.reason.trim() : "";
    const { data: call } = await supabaseAdmin
      .from("upcoming_calls")
      .select("title, scheduled_at")
      .eq("id", params.id)
      .maybeSingle();
    // Record the reason in the brain's learned memory so it sticks.
    try {
      const { data: prof } = await supabaseAdmin
        .from("workspace_profile")
        .select("learned")
        .eq("id", profileId)
        .maybeSingle();
      const prev =
        prof && typeof prof.learned === "string" ? prof.learned.trim() : "";
      const when = call?.scheduled_at
        ? new Date(call.scheduled_at).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
          })
        : "";
      const note = `Call "${call?.title || "(untitled)"}"${
        when ? ` (${when})` : ""
      } is not happening${reason ? `. Reason: ${reason}` : " (cancelled)"}.`;
      let next = prev ? `${prev}\n- ${note}` : `- ${note}`;
      if (next.length > 8000) next = next.slice(-8000);
      await supabaseAdmin
        .from("workspace_profile")
        .update({ learned: next })
        .eq("id", profileId);
    } catch {
      /* noting the reason is best-effort */
    }
    const { data, error } = await supabaseAdmin
      .from("upcoming_calls")
      .delete()
      .eq("id", params.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json({ error: "call not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to cancel the call" },
      { status: 500 }
    );
  }
}

// DELETE /api/crm/upcoming/:id -> remove a scheduled call.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from("upcoming_calls")
      .delete()
      .eq("id", params.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json({ error: "call not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to delete" },
      { status: 500 }
    );
  }
}
