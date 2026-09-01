import { supabaseAdmin } from "@/lib/supabase";

export type WorkstreamScope = {
  id: string;
  companyId: string;
  name: string;
  kind: string;
  status: string;
  purpose: string;
  departmentId: string | null;
  departmentName: string | null;
};

const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);

const externalEmails = (attendees: unknown): string[] =>
  Array.from(
    new Set(
      (Array.isArray(attendees) ? attendees : [])
        .filter((attendee: any) => attendee && !attendee.self)
        .map((attendee: any) => String(attendee.email || "").trim().toLowerCase())
        .filter((email: string) => email.includes("@"))
    )
  );

export async function getWorkstreamScope(
  workstreamId: unknown
): Promise<WorkstreamScope | null> {
  if (!uuid(workstreamId)) return null;
  const { data, error } = await supabaseAdmin
    .from("workstreams")
    .select("id, company_id, department_id, name, kind, status, purpose")
    .eq("id", workstreamId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  let departmentName: string | null = null;
  if (data.department_id) {
    const { data: department, error: departmentError } = await supabaseAdmin
      .from("departments")
      .select("name")
      .eq("id", data.department_id)
      .maybeSingle();
    if (departmentError) throw departmentError;
    departmentName = department?.name || null;
  }

  return {
    id: data.id,
    companyId: data.company_id,
    departmentId: data.department_id || null,
    departmentName,
    name: data.name,
    kind: data.kind,
    status: data.status,
    purpose: data.purpose || "",
  };
}

// Exact email matches only. If the people on an invite belong to more than one
// active workstream, return null and let the user choose rather than combining
// those threads or guessing from the company name.
export async function resolveWorkstreamFromAttendees(opts: {
  companyId: string;
  attendees: unknown;
}): Promise<WorkstreamScope | null> {
  const emails = externalEmails(opts.attendees);
  if (!uuid(opts.companyId) || !emails.length) return null;

  const { data: contacts, error: contactError } = await supabaseAdmin
    .from("contacts")
    .select("id, email")
    .eq("company_id", opts.companyId);
  if (contactError) throw contactError;
  const contactIds = (contacts || [])
    .filter((contact: any) =>
      emails.includes(String(contact.email || "").trim().toLowerCase())
    )
    .map((contact: any) => contact.id);
  if (!contactIds.length) return null;

  const { data: links, error: linkError } = await supabaseAdmin
    .from("workstream_contacts")
    .select("workstream_id")
    .eq("company_id", opts.companyId)
    .in("contact_id", contactIds);
  if (linkError) throw linkError;
  const ids = Array.from(
    new Set((links || []).map((link: any) => String(link.workstream_id)))
  );
  if (!ids.length) return null;

  const { data: active, error: workstreamError } = await supabaseAdmin
    .from("workstreams")
    .select("id")
    .eq("company_id", opts.companyId)
    .eq("status", "active")
    .in("id", ids);
  if (workstreamError) throw workstreamError;
  if (!active || active.length !== 1) return null;
  return getWorkstreamScope(active[0].id);
}

export async function resolveCallScope(opts: {
  companyId?: unknown;
  upcomingId?: unknown;
  workstreamId?: unknown;
  attendees?: unknown;
  leadEmail?: unknown;
}): Promise<{ companyId: string | null; workstream: WorkstreamScope | null }> {
  let companyId = uuid(opts.companyId) ? opts.companyId : null;
  const hasLeadDecision = Object.prototype.hasOwnProperty.call(
    opts,
    "leadEmail"
  );
  const leadEmail =
    typeof opts.leadEmail === "string" ? opts.leadEmail.trim().toLowerCase() : "";
  const leadOnlyAttendees = leadEmail ? [{ email: leadEmail }] : [];

  if (uuid(opts.upcomingId)) {
    const { data: upcoming, error } = await supabaseAdmin
      .from("upcoming_calls")
      .select("company_id, workstream_id, attendees")
      .eq("id", opts.upcomingId)
      .maybeSingle();
    if (error) throw error;
    // Once an exact scheduled call exists, its current client link is the
    // authority. The browser may still be carrying the company selected when
    // the call tab first opened, especially if the calendar event was corrected
    // while the call was live. A deliberately unassigned event is authoritative
    // too, so do not let that stale browser value leak into another client.
    if (upcoming) {
      companyId = uuid(upcoming.company_id) ? upcoming.company_id : null;
      if (!companyId) return { companyId: null, workstream: null };
    }
    if (upcoming?.workstream_id) {
      const workstream = await getWorkstreamScope(upcoming.workstream_id);
      return { companyId, workstream };
    }
    if (companyId) {
      const workstream = await resolveWorkstreamFromAttendees({
        companyId,
        attendees: hasLeadDecision
          ? leadOnlyAttendees
          : upcoming?.attendees || opts.attendees,
      });
      if (workstream) {
        await supabaseAdmin
          .from("upcoming_calls")
          .update({ workstream_id: workstream.id })
          .eq("id", opts.upcomingId)
          .is("workstream_id", null);
        return { companyId, workstream };
      }
    }
  }

  const requested = await getWorkstreamScope(opts.workstreamId);
  if (requested && (!companyId || requested.companyId === companyId)) {
    return { companyId: requested.companyId, workstream: requested };
  }

  if (companyId) {
    const workstream = await resolveWorkstreamFromAttendees({
      companyId,
      attendees: hasLeadDecision ? leadOnlyAttendees : opts.attendees,
    });
    return { companyId, workstream };
  }
  return { companyId: null, workstream: null };
}
