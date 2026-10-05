// Keep email -> intent ordering explicit. The caller passes the result straight
// to the planner rather than relying on React state updates having rendered.
export async function refreshCallPrepContext(
  request: (url: string, options?: { method: string; body: string }) => Promise<any>,
  call: { id: string; company_id?: string | null; workstream_id?: string | null; primaryAttendee?: { email: string; name?: string } | null },
) {
  if (!call.company_id) return null;
  let mail: any = null;
  if (call.primaryAttendee?.email) {
    mail = await request("/api/crm/email-pull", {
      method: "POST",
      body: JSON.stringify({
        companyId: call.company_id,
        workstreamId: call.workstream_id || undefined,
        upcomingId: call.id,
        email: call.primaryAttendee.email,
        name: call.primaryAttendee.name || undefined,
      }),
    });
    if (mail?.ok === false || mail?.error) {
      throw new Error(mail.error || "Latest email could not be checked");
    }
  }
  const fresh = await request(`/api/crm/companies/${call.company_id}/prep-intent`, {
    method: "POST",
    body: JSON.stringify({ concise: true, upcomingId: call.id }),
  });
  return { intent: typeof fresh?.intent === "string" ? fresh.intent.trim() : "", mail };
}
