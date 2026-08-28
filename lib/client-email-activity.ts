import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { nameFromHeader, type MailMessage, type MailProvider } from "@/lib/mail";
import { detectOutOfOffice, type OutOfOfficeSignal } from "@/lib/email-reply-signals";

export type ClientEmailTarget = {
  companyId: string | null;
  contactId: string | null;
  outreachProspectId: string | null;
  workstreamId: string | null;
  ambiguous: boolean;
};

const exactEmail = (value: unknown, expected: string) =>
  String(value || "").trim().toLowerCase() === expected;

const limitedFreshText = (value: unknown, max = 2400) => {
  const clean = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clean.length > max
    ? `${clean.slice(0, max).replace(/\s+\S*$/, "").trim()}…`
    : clean;
};

export async function resolveClientEmailTarget(
  senderEmail: string
): Promise<ClientEmailTarget> {
  const email = String(senderEmail || "").trim().toLowerCase();
  if (!email) {
    return {
      companyId: null,
      contactId: null,
      outreachProspectId: null,
      workstreamId: null,
      ambiguous: false,
    };
  }

  const pattern = email.replace(/[\\%_]/g, (value) => `\\${value}`);
  const [{ data: contactRows, error: contactError }, { data: prospectRows, error: prospectError }] =
    await Promise.all([
      supabaseAdmin
        .from("contacts")
        .select("id,company_id,email")
        .ilike("email", pattern)
        .limit(20),
      supabaseAdmin
        .from("outreach_prospects")
        .select("id,crm_company_id,email")
        .ilike("email", pattern)
        .limit(20),
    ]);
  if (contactError) throw contactError;
  if (prospectError) throw prospectError;

  const contacts = (contactRows || []).filter((row: any) => exactEmail(row.email, email));
  const prospects = (prospectRows || []).filter((row: any) => exactEmail(row.email, email));
  const companyIds = new Set<string>();
  for (const row of contacts) if (row.company_id) companyIds.add(String(row.company_id));
  for (const row of prospects) if (row.crm_company_id) companyIds.add(String(row.crm_company_id));

  const ambiguous = companyIds.size > 1 || contacts.length > 1 || prospects.length > 1;
  if (ambiguous) {
    return {
      companyId: null,
      contactId: null,
      outreachProspectId: null,
      workstreamId: null,
      ambiguous: true,
    };
  }

  const contactId = contacts[0]?.id ? String(contacts[0].id) : null;
  let workstreamId: string | null = null;
  if (contactId) {
    const { data: workstreamRows, error: workstreamError } = await supabaseAdmin
      .from("workstream_contacts")
      .select("workstream_id")
      .eq("contact_id", contactId)
      .limit(3);
    if (workstreamError) throw workstreamError;
    const ids = [...new Set((workstreamRows || []).map((row: any) => String(row.workstream_id || "")).filter(Boolean))];
    if (ids.length === 1) workstreamId = ids[0];
  }

  return {
    companyId: companyIds.size === 1 ? [...companyIds][0] : null,
    contactId,
    outreachProspectId: prospects[0]?.id ? String(prospects[0].id) : null,
    workstreamId,
    ambiguous: false,
  };
}

export async function recordClientEmailActivity(input: {
  provider: MailProvider;
  message: MailMessage;
  freshText: string;
  target: ClientEmailTarget;
  outOfOffice?: OutOfOfficeSignal;
}): Promise<{ inserted: boolean; id: string | null }> {
  if (!input.target.companyId || input.target.ambiguous) {
    return { inserted: false, id: null };
  }
  const received = new Date(input.message.date || "");
  const receivedAt = Number.isFinite(received.getTime())
    ? received.toISOString()
    : new Date().toISOString();
  const outOfOffice = input.outOfOffice || detectOutOfOffice({
    subject: input.message.subject,
    freshText: input.freshText,
    autoSubmitted: input.message.autoSubmitted,
    receivedAt,
  });
  const senderName = nameFromHeader(input.message.from) || "Contact";
  const senderEmail = String(input.message.from || "")
    .match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]
    ?.toLowerCase() || "";
  const sourceRef = `${input.provider}:${input.message.id}`;
  const content = limitedFreshText(input.freshText || input.message.snippet);
  const { data, error } = await supabaseAdmin
    .from("client_context")
    .upsert(
      {
        company_id: input.target.companyId,
        workstream_id: input.target.workstreamId,
        kind: "email_reply",
        title: outOfOffice.isOutOfOffice
          ? `Out of office reply from ${senderName}`
          : `Email reply from ${senderName}`,
        content,
        created_at: receivedAt,
        source_ref: sourceRef,
        metadata: {
          provider: input.provider,
          messageId: input.message.id,
          threadId: input.message.threadId || null,
          senderEmail,
          senderName,
          subject: String(input.message.subject || "").slice(0, 240),
          receivedAt,
          replyType: outOfOffice.isOutOfOffice ? "out_of_office" : "reply",
          returnDate: outOfOffice.returnDate,
        },
        visibility: "private",
      },
      {
        onConflict: "owner_id,source_ref",
        ignoreDuplicates: true,
      }
    )
    .select("id");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return { inserted: !!row?.id, id: row?.id ? String(row.id) : null };
}
