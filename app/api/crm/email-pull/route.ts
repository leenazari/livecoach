import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveExistingCompany } from "@/lib/company-resolver";
import { normaliseCompanyDomain } from "@/lib/company-identity";
import { openai, OPENAI_MODEL_LIVE } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { createHash } from "crypto";
import { getWorkstreamScope } from "@/lib/workstreams";
import {
  recentMessages,
  digestMessages,
  emailFromHeader,
  freshMessageText,
  nameFromHeader,
  mailboxConnected,
  connectedMailProvider,
} from "@/lib/mail";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";
import {
  loadPrimaryAttendeeForUpcoming,
  loadProtectedIntentDomains,
} from "@/lib/call-subject";
import {
  calendarEmailDomain,
  emailMayInfluenceCompanyIntent,
} from "@/lib/calendar-subject";
import { privateRecordFields, resolveRecordScope } from "@/lib/record-scope";
import { loadAssignedClientAccess } from "@/lib/assigned-client-access";
import { crmBlockerPayload } from "@/lib/crm-blocker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

// PULL A CONTACT'S EMAIL AND BUILD A CLIENT FROM IT. Given a person (name or
// email) or a company, this reads the recent connected-mail thread with them, distils it
// into a clean context note, and creates or updates the client + contact. This
// is what gives the brain the power to "pull X's email and create the client",
// and it is also what the sent-mail sweep uses to auto-create clients.

// Free / personal mail hosts: their domain is a mailbox, not a company site.
const PERSONAL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "aol.com", "proton.me",
  "protonmail.com", "gmx.com", "msn.com", "btinternet.com",
]);

const houseStyle = (s: string) =>
  String(s || "")
    .replace(/[—–]/g, ", ")
    .replace(/;/g, ",")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

async function myAddresses(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const identity = await resolveOutreachIdentity();
    set.add(identity.senderEmail);
    set.add(identity.mailboxEmail);
  } catch {
    try {
      const connection = await connectedMailProvider();
      if (connection.email) set.add(connection.email.toLowerCase());
    } catch {
      /* best-effort */
    }
  }
  return set;
}

export async function POST(req: NextRequest) {
  try {
    const scope = await resolveRecordScope();
    const body = await req.json().catch(() => ({}));
    let name = typeof body.name === "string" ? body.name.trim() : "";
    let email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    let companyId =
      typeof body.companyId === "string" ? body.companyId.trim() : "";
    const contactId =
      typeof body.contactId === "string" ? body.contactId.trim() : "";
    const requestedWorkstreamId =
      typeof body.workstreamId === "string" ? body.workstreamId.trim() : "";
    const upcomingId =
      typeof body.upcomingId === "string" ? body.upcomingId.trim() : "";
    let matchedContact: any = null;
    if (contactId) {
      const { data, error: contactError } = await supabaseAdmin
        .from("contacts")
        .select("id,company_id,name,email")
        .eq("id", contactId)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .maybeSingle();
      if (contactError) throw contactError;
      if (!data) {
        return NextResponse.json(
          crmBlockerPayload({
            code: "email_contact_not_available",
            title: "Email history not pulled",
            reason: "The selected contact is not available to your account",
            nextAction: "Open your own contact record or ask a workspace owner to assign the client",
            responsible: "owner",
          }),
          { status: 404 }
        );
      }
      matchedContact = data;
    } else if (name && !email) {
      const term = name.replace(/[%_]/g, "").trim().slice(0, 100);
      const { data, error: contactError } = await supabaseAdmin
        .from("contacts")
        .select("id,company_id,name,email")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .ilike("name", `%${term}%`)
        .not("email", "is", null)
        .limit(8);
      if (contactError) throw contactError;
      const exact = (data || []).filter(
        (contact: any) =>
          String(contact.name || "").trim().toLowerCase() ===
          name.toLowerCase()
      );
      const candidates = exact.length ? exact : data || [];
      if (candidates.length === 1) matchedContact = candidates[0];
      else if (candidates.length > 1) {
        return NextResponse.json(
          crmBlockerPayload({
            code: "email_contact_ambiguous",
            title: "Exact email needed",
            reason: `More than one of your contacts matches ${name}`,
            nextAction: "Enter the person's exact email address and pull the thread again",
            responsible: "user",
          }),
          { status: 409 }
        );
      }
    }
    if (matchedContact) {
      const contactEmail = String(matchedContact.email || "").trim().toLowerCase();
      if (email && contactEmail && email !== contactEmail) {
        return NextResponse.json(
          crmBlockerPayload({
            code: "email_contact_mismatch",
            title: "Email history not pulled",
            reason: "The selected contact and email address do not match",
            nextAction: "Open the correct contact or enter the exact address before trying again",
            responsible: "user",
          }),
          { status: 409 }
        );
      }
      if (!email) email = contactEmail;
      if (!name) name = String(matchedContact.name || "").trim();
      if (!companyId && matchedContact.company_id) {
        companyId = String(matchedContact.company_id);
      }
      if (
        companyId &&
        matchedContact.company_id &&
        companyId !== String(matchedContact.company_id)
      ) {
        return NextResponse.json(
          crmBlockerPayload({
            code: "email_contact_company_mismatch",
            title: "Email history not pulled",
            reason: "The selected contact belongs to a different client",
            nextAction: "Open the contact's correct client and pull the email thread there",
            responsible: "user",
          }),
          { status: 409 }
        );
      }
    }

    const companyAccess = companyId
      ? await loadAssignedClientAccess(companyId, scope)
      : null;
    if (companyId && !companyAccess) {
      return NextResponse.json(
        crmBlockerPayload({
          code: "email_client_not_assigned",
          title: "Email history not pulled",
          reason: "The selected client is not owned by or assigned to your account",
          nextAction: "Ask a workspace owner to assign the client, then pull the email thread again",
          responsible: "owner",
        }),
        { status: 404 }
      );
    }
    const sharedSalesTarget = companyAccess?.mode === "shared_sales";
    let workstream = requestedWorkstreamId
      ? await getWorkstreamScope(requestedWorkstreamId)
      : null;
    if (workstream) {
      const { data: ownedWorkstream, error: workstreamAccessError } =
        await supabaseAdmin
          .from("workstreams")
          .select("id")
          .eq("id", workstream.id)
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .maybeSingle();
      if (workstreamAccessError) throw workstreamAccessError;
      if (!ownedWorkstream) workstream = null;
    }
    if (!workstream && sharedSalesTarget && email) {
      const { data: personalThreads, error: threadError } = await supabaseAdmin
        .from("workstreams")
        .select("id,company_id,department_id,name,kind,status,purpose,email_context_meta")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq("company_id", companyId)
        .eq("status", "active")
        .limit(50);
      if (threadError) throw threadError;
      const personalThread = (personalThreads || []).find(
          (thread: any) =>
            String(
              thread.email_context_meta?.email_context_counterparty_email || ""
            ).toLowerCase() === email
        );
      workstream = personalThread
        ? {
            id: personalThread.id,
            companyId: personalThread.company_id,
            departmentId: personalThread.department_id || null,
            departmentName: null,
            name: personalThread.name,
            kind: personalThread.kind,
            status: personalThread.status,
            purpose: personalThread.purpose || "",
          }
        : null;
    }
    if (
      requestedWorkstreamId &&
      (!workstream || !companyId || workstream.companyId !== companyId)
    ) {
      return NextResponse.json(
        { error: "workstream does not belong to this company" },
        { status: 409 }
      );
    }
    let query = typeof body.query === "string" ? body.query.trim() : "";

    // Automatic pre-call context is bound to one exact calendar event. The
    // server independently resolves that event's lead attendee, so a browser,
    // cron job or stale tab cannot write a supporting invitee's email history
    // into the linked client merely because that invitee appeared first.
    if (upcomingId) {
      const resolved = await loadPrimaryAttendeeForUpcoming(upcomingId);
      if (!resolved.call) {
        return NextResponse.json(
          { error: "The scheduled call could not be found." },
          { status: 404 }
        );
      }
      if (
        !companyId ||
        String(resolved.call.company_id || "") !== companyId
      ) {
        return NextResponse.json(
          { error: "The scheduled call is not linked to this client." },
          { status: 409 }
        );
      }
      if (!resolved.primaryAttendee?.email) {
        return NextResponse.json(
          {
            error:
              "The meeting's lead person is ambiguous. Choose the person before loading email context.",
          },
          { status: 409 }
        );
      }
      if (email && email !== resolved.primaryAttendee.email) {
        return NextResponse.json(
          {
            error:
              "The selected email belongs to another invitee, so no client context was changed.",
          },
          { status: 409 }
        );
      }
      email = resolved.primaryAttendee.email;
      if (!name) name = resolved.primaryAttendee.name;
      query = "";
    }

    // If we were handed a company, search its recorded contact / domain.
    if (!email && !name && !query && companyId) {
      const co = companyAccess?.company || null;
      const { data: ct } = await supabaseAdmin
        .from("contacts")
        .select("email")
        .eq("company_id", companyId)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .not("email", "is", null)
        .limit(20);
      const companyDomain = normaliseCompanyDomain(co?.domain || co?.website);
      const matchingContact = (ct || []).find(
        (row: any) =>
          calendarEmailDomain(String(row.email || "")) === companyDomain
      );
      const onlyUnanchoredContact =
        !companyDomain && ct?.length === 1 ? ct[0] : null;
      email = String(
        matchingContact?.email || onlyUnanchoredContact?.email || ""
      )
        .toLowerCase()
        .trim();
      if (!email && co?.domain) query = `@${co.domain}`;
      else if (!email && co?.name) query = `"${co.name}"`;
    }

    if (!query) {
      query = email
        ? `from:${email} OR to:${email}`
        : name
        ? `"${name}"`
        : "";
    }
    if (!query) {
      return NextResponse.json(
        crmBlockerPayload({
          code: "email_target_missing",
          title: "Email history needs a person",
          reason: "No contact name, email address or client was supplied",
          nextAction: "Enter the person's name or exact email address and try again",
          responsible: "user",
        }),
        { status: 400 }
      );
    }

    // For an existing client, load the rolling summary before touching the mailbox.
    // The newest processed message id lets subsequent refreshes use only the
    // new message bodies instead of paying to resend the old conversation.
    let cachedCompany: any = null;
    if (companyId) {
      if (sharedSalesTarget) {
        cachedCompany = {
          ...companyAccess?.company,
          profile: {},
          email_context: null,
          email_context_updated_at: null,
        };
      } else {
        const { data, error: companyError } = await supabaseAdmin
          .from("companies")
          .select(
            "name, domain, website, profile, email_context, email_context_updated_at"
          )
          .eq("id", companyId)
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .maybeSingle();
        if (companyError) throw companyError;
        cachedCompany = data || null;
      }
    }
    const { data: cachedThread } = workstream
      ? await supabaseAdmin
          .from("workstreams")
          .select("email_context, email_context_updated_at, email_context_meta")
          .eq("id", workstream.id)
          .maybeSingle()
      : { data: null };

    const protectedIntentDomains = companyId
      ? await loadProtectedIntentDomains()
      : [];
    const emailAllowedForTarget = (candidate: string) =>
      !companyId ||
      !cachedCompany ||
      emailMayInfluenceCompanyIntent(candidate, {
        companyDomain: normaliseCompanyDomain(
          cachedCompany.domain || cachedCompany.website
        ),
        companyInternal: (cachedCompany.profile as any)?.internal === true,
        protectedDomains: protectedIntentDomains,
      });
    if (email && !emailAllowedForTarget(email)) {
      return NextResponse.json(
        {
          error:
            "That address is a supporting internal or protected attendee, so it cannot change this client's email context or intent.",
        },
        { status: 409 }
      );
    }

    let msgs: Awaited<ReturnType<typeof recentMessages>> = [];
    try {
      msgs = await recentMessages(query, 25);
    } catch {
      return NextResponse.json(
        crmBlockerPayload({
          code: "email_mailbox_read_failed",
          title: "Mailbox could not be read",
          reason: "LiveCoach could not complete a search of the signed-in user's connected mailbox",
          nextAction: "Reconnect Google or Microsoft in Settings, then try the email pull once more",
          responsible: "user",
        }),
        { status: 502 }
      );
    }
    if (!msgs.length) {
      const connected = await mailboxConnected();
      return NextResponse.json(
        crmBlockerPayload(
          connected
            ? {
                code: "email_thread_not_found",
                title: "No matching email found",
                reason: `No recent email matched ${email || name || query} in the signed-in user's mailbox`,
                nextAction: "Check the exact email address and search again. The CRM contact and callback remain saved",
                responsible: "user",
              }
            : {
                code: "email_mailbox_not_connected",
                title: "Email is not connected",
                reason: "This account has no readable Google or Microsoft mailbox connection",
                nextAction: "Connect this user's mailbox in Settings, then pull the email thread again",
                responsible: "user",
              }
        ),
        { status: connected ? 404 : 409 }
      );
    }

    // Work out who the OTHER party is (not the user's own addresses). If an email
    // was given, that is them; otherwise take the most frequent counterparty.
    const mine = await myAddresses();
    let counterparty = email;
    if (!counterparty) {
      const tally = new Map<string, number>();
      for (const m of msgs) {
        for (const h of [m.from, m.to, m.cc]) {
          for (const part of String(h || "").split(",")) {
            const e = emailFromHeader(part);
            if (e && !mine.has(e)) tally.set(e, (tally.get(e) || 0) + 1);
          }
        }
      }
      counterparty =
        [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    }
    if (!counterparty) {
      return NextResponse.json(
        { error: "couldn't work out who the other person is from those emails" },
        { status: 422 }
      );
    }
    if (!emailAllowedForTarget(counterparty)) {
      return NextResponse.json(
        {
          error:
            "That address is a supporting internal or protected attendee, so it cannot change this client's email context or intent.",
        },
        { status: 409 }
      );
    }
    const domain = counterparty.split("@")[1] || "";
    const isCompanyDomain = !!domain && !PERSONAL.has(domain.toLowerCase());
    // A display name for the person, from a header that carried this address.
    let personName = name;
    if (!personName) {
      for (const m of msgs) {
        for (const h of [m.from, m.to, m.cc]) {
          if (emailFromHeader(h) === counterparty) {
            const n = nameFromHeader(h);
            if (n) {
              personName = n;
              break;
            }
          }
        }
        if (personName) break;
      }
    }
    if (!personName) personName = nameFromHeader(counterparty);

    // Metadata is cheap and bounded. It is used only to detect whether the
    // mailbox changed; AI receives fresh message text, not the whole thread.
    const digest = digestMessages(msgs, 15);
    const sourceHash = createHash("sha256").update(digest).digest("hex");

    // Reopening Prep should not re-summarise the same inbox thread. The digest
    // hash changes only when the relevant recent messages change.
    if (companyId && cachedCompany) {
      const profile = workstream
        ? ((cachedThread as any)?.email_context_meta || {})
        : (cachedCompany.profile as any);
      const cachedEmailContext = workstream
        ? (cachedThread as any)?.email_context
        : cachedCompany.email_context;
      const cachedEmailUpdatedAt = workstream
        ? (cachedThread as any)?.email_context_updated_at
        : cachedCompany.email_context_updated_at;
      if (
        profile &&
        (profile.email_context_source_hash === sourceHash ||
          profile.email_last_message_id === msgs[0]?.id) &&
        typeof cachedEmailContext === "string" &&
        cachedEmailContext.trim()
      ) {
        // Keep the actual newest message time separately from the time we
        // refreshed its AI summary. The opportunity board uses this to spot a
        // quiet relationship without mistaking a refresh for a new email.
        const emailMeta = {
          ...(profile || {}),
          email_last_message_id: msgs[0]?.id || null,
          email_last_message_at: msgs[0]?.date || null,
          email_context_counterparty_email: counterparty,
          email_context_counterparty_domain: domain || null,
        };
        if (workstream) {
          const { data: savedThread, error: saveThreadError } = await supabaseAdmin
            .from("workstreams")
            .update({
              email_context_meta: emailMeta,
              updated_at: new Date().toISOString(),
            })
            .eq("id", workstream.id)
            .eq("workspace_id", scope.workspaceId)
            .eq("owner_id", scope.userId)
            .select("id")
            .maybeSingle();
          if (saveThreadError) throw saveThreadError;
          if (!savedThread) throw new Error("The relationship refresh was not saved");
        } else {
          const { data: savedCompany, error: saveCompanyError } = await supabaseAdmin
            .from("companies")
            .update({ profile: emailMeta })
            .eq("id", companyId)
            .eq("workspace_id", scope.workspaceId)
            .eq("owner_id", scope.userId)
            .select("id")
            .maybeSingle();
          if (saveCompanyError) throw saveCompanyError;
          if (!savedCompany) throw new Error("The client refresh was not saved");
        }
        return NextResponse.json({
          ok: true,
          cached: true,
          companyId,
          name: cachedCompany.name,
          person: personName,
          email: counterparty,
          workstreamId: workstream?.id || null,
          emailContext: cachedEmailContext,
          emailContextUpdatedAt: cachedEmailUpdatedAt,
          created: false,
          messages: msgs.length,
        });
      }
    }

    const existingContext =
      typeof (workstream
        ? (cachedThread as any)?.email_context
        : cachedCompany?.email_context) === "string"
        ? String(
            workstream
              ? (cachedThread as any)?.email_context
              : cachedCompany?.email_context
          ).trim()
        : "";
    const previousMessageId = workstream
      ? (cachedThread as any)?.email_context_meta?.email_last_message_id
      : (cachedCompany?.profile as any)?.email_last_message_id;
    const previousIndex = previousMessageId
      ? msgs.findIndex((message) => message.id === previousMessageId)
      : -1;
    const newMessages = existingContext
      ? msgs.slice(0, previousIndex >= 0 ? previousIndex : Math.min(8, msgs.length))
      : [];
    let modelDigest = digest;
    let incremental = false;
    if (existingContext && newMessages.length) {
      const freshParts = await Promise.all(
        newMessages.slice(0, 8).map(async (message) => {
          const fresh =
            (await freshMessageText(message.id, 1400)) || message.snippet;
          return `${message.date} | ${message.from} | ${message.subject}\n${fresh}`;
        })
      );
      modelDigest = freshParts.join("\n\n").slice(0, 6000);
      incremental = true;
    }
    let emailContext = "";
    let companyName = "";
    try {
      const msg = await openai.messages.create({
        model: OPENAI_MODEL_LIVE,
        max_tokens: 600,
        system: `You maintain a short, clean CLIENT CONTEXT note for the signed-in LiveCoach user. Write about the OTHER party (${personName}${
          isCompanyDomain ? `, ${domain}` : ""
        }). Output ONLY JSON: {"companyName": "the org name to file them under (their company if it is a business, else their name)", "emailContext": "3 to 6 plain sentences: who they are, what the relationship is about, where it is up to, and the next step."}. Update the saved context with only the fresh messages. Preserve still-relevant facts, replace superseded details, and never invent. No markdown, em dashes or semicolons.`,
        messages: [
          {
            role: "user",
            content: `OTHER PARTY: ${personName} <${counterparty}>${
              isCompanyDomain ? `\nCompany domain: ${domain}` : ""
            }${incremental ? `\n\nSAVED ROLLING CONTEXT:\n${existingContext.slice(0, 1200)}\n\nFRESH MESSAGES ONLY (newest first):` : "\n\nRECENT MESSAGE DIGEST (newest first):"}\n${modelDigest}\n\nReturn the JSON.`,
          },
        ],
      });
      await logModelUsage("email-pull", "live", (msg as any).usage);
      const raw = msg.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("")
        .replace(/```json|```/g, "")
        .trim();
      const a = raw.indexOf("{");
      const z = raw.lastIndexOf("}");
      const parsed = a >= 0 && z > a ? JSON.parse(raw.slice(a, z + 1)) : null;
      if (parsed) {
        emailContext =
          typeof parsed.emailContext === "string"
            ? houseStyle(parsed.emailContext)
            : "";
        companyName =
          typeof parsed.companyName === "string" ? parsed.companyName.trim() : "";
      }
    } catch {
      /* fall back below */
    }
    if (!companyName)
      companyName = isCompanyDomain
        ? domain.split(".")[0].replace(/\b\w/g, (c: string) => c.toUpperCase())
        : personName || counterparty;
    if (!emailContext)
      emailContext = `Email contact ${personName} <${counterparty}>. Recent thread:\n${digest.slice(0, 800)}`;

    const website = isCompanyDomain ? `https://${domain}` : null;
    const nowIso = new Date().toISOString();
    const emailMeta = {
      ...((cachedThread as any)?.email_context_meta || {}),
      email_context_source_hash: sourceHash,
      email_last_message_id: msgs[0]?.id || null,
      email_last_message_at: msgs[0]?.date || null,
      email_context_counterparty_email: counterparty,
      email_context_counterparty_domain: domain || null,
    };

    // A salesperson's mailbox summary must not overwrite the original owner's
    // private client context. Keep it in the assignee's own relationship thread
    // and link only the contact that this salesperson created.
    if (sharedSalesTarget && companyId) {
      const { data: sameEmailContacts, error: contactLookupError } =
        await supabaseAdmin
          .from("contacts")
          .select("id,company_id,name,email")
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .ilike("email", counterparty)
          .limit(5);
      if (contactLookupError) throw contactLookupError;
      const contactOnAnotherClient = (sameEmailContacts || []).find(
        (contact: any) => String(contact.company_id || "") !== companyId
      );
      if (contactOnAnotherClient) {
        return NextResponse.json(
          crmBlockerPayload({
            code: "email_contact_already_on_another_client",
            title: "Email history not filed",
            reason: `${contactOnAnotherClient.name} already exists on another client in your CRM`,
            nextAction: "Correct the existing contact's company, then pull the email thread again",
            responsible: "user",
          }),
          { status: 409 }
        );
      }
      let privateContactId = (sameEmailContacts || []).find(
        (contact: any) => String(contact.company_id || "") === companyId
      )?.id;
      let privateWorkstreamId = workstream?.id || "";
      let relationshipCreated = false;
      if (privateWorkstreamId) {
        const { data: savedThread, error: saveThreadError } = await supabaseAdmin
          .from("workstreams")
          .update({
            email_context: emailContext,
            email_context_updated_at: nowIso,
            email_context_meta: emailMeta,
            updated_at: nowIso,
          })
          .eq("id", privateWorkstreamId)
          .eq("company_id", companyId)
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .select("id")
          .maybeSingle();
        if (saveThreadError) throw saveThreadError;
        if (!savedThread) throw new Error("The private relationship thread was not updated");
      } else {
        const { data: savedThread, error: saveThreadError } = await supabaseAdmin
          .from("workstreams")
          .insert({
            company_id: companyId,
            name: personName || counterparty,
            kind: "relationship",
            status: "active",
            purpose: `Email relationship with ${personName || counterparty}`,
            email_context: emailContext,
            email_context_updated_at: nowIso,
            email_context_meta: emailMeta,
            ...privateRecordFields(scope),
          })
          .select("id")
          .single();
        if (saveThreadError) throw saveThreadError;
        if (!savedThread?.id) throw new Error("The private relationship thread was not created");
        privateWorkstreamId = savedThread.id;
        relationshipCreated = true;
      }

      if (!privateContactId) {
        const { data: savedContact, error: saveContactError } = await supabaseAdmin
          .from("contacts")
          .insert({
            company_id: companyId,
            name: personName || counterparty,
            email: counterparty,
            ...privateRecordFields(scope),
          })
          .select("id")
          .single();
        if (saveContactError) throw saveContactError;
        if (!savedContact?.id) throw new Error("The private contact was not created");
        privateContactId = savedContact.id;
      }
      const { error: linkError } = await supabaseAdmin
        .from("workstream_contacts")
        .upsert(
          {
            workstream_id: privateWorkstreamId,
            contact_id: privateContactId,
            company_id: companyId,
            relationship_role: "primary",
            is_primary: true,
            ...privateRecordFields(scope),
          },
          {
            onConflict: "workstream_id,contact_id",
            ignoreDuplicates: true,
          }
        );
      if (linkError) throw linkError;

      return NextResponse.json({
        ok: true,
        companyId,
        workstreamId: privateWorkstreamId,
        contactId: privateContactId,
        name: companyAccess?.company?.name || companyName,
        person: personName,
        email: counterparty,
        created: false,
        relationshipCreated,
        messages: msgs.length,
        emailContext,
        emailContextUpdatedAt: nowIso,
      });
    }

    // Find an existing client: the one we were told, else one on this domain,
    // else create a fresh one. Never duplicate.
    const explicitTarget = !!companyId;
    let targetId = companyId;
    if (!targetId) {
      const existing = await resolveExistingCompany({
        name: companyName,
        domain: isCompanyDomain ? domain : null,
      });
      if (existing) targetId = existing.id;
    }
    let created = false;
    let targetCompany: any = null;
    if (targetId) {
      const { data: existingCompany } = await supabaseAdmin
        .from("companies")
        .select("id,name,domain,website,profile")
        .eq("id", targetId)
        .maybeSingle();
      targetCompany = existingCompany || null;
      const companyEmailMeta = {
        ...((workstream
          ? (cachedThread as any)?.email_context_meta
          : existingCompany?.profile) || {}),
        email_context_source_hash: sourceHash,
        email_last_message_id: msgs[0]?.id || null,
        email_last_message_at: msgs[0]?.date || null,
        email_context_counterparty_email: counterparty,
        email_context_counterparty_domain: domain || null,
      };
      const patch: Record<string, any> = workstream
        ? { updated_at: nowIso }
        : {
            email_context: emailContext,
            email_context_updated_at: nowIso,
            updated_at: nowIso,
            profile: companyEmailMeta,
          };
      // Pulling an internal or cross-relationship email into a client's
      // context must never replace that client's own identity. Only an
      // automatically resolved record may have a missing domain filled here.
      if (!explicitTarget && website && !existingCompany?.website) patch.website = website;
      if (!explicitTarget && domain && !existingCompany?.domain) patch.domain = domain;
      const { data: savedCompany, error: saveCompanyError } = await supabaseAdmin
        .from("companies")
        .update(patch)
        .eq("id", targetId)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .select("id")
        .maybeSingle();
      if (saveCompanyError) throw saveCompanyError;
      if (!savedCompany) throw new Error("The client email context was not updated");
      if (workstream) {
        const { data: savedThread, error: saveThreadError } = await supabaseAdmin
          .from("workstreams")
          .update({
            email_context: emailContext,
            email_context_updated_at: nowIso,
            email_context_meta: emailMeta,
            updated_at: nowIso,
          })
          .eq("id", workstream.id)
          .eq("company_id", targetId)
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .select("id")
          .maybeSingle();
        if (saveThreadError) throw saveThreadError;
        if (!savedThread) throw new Error("The relationship email context was not updated");
      }
    } else {
      const { data: ins, error: insertCompanyError } = await supabaseAdmin
        .from("companies")
        .insert({
          name: companyName,
          domain: domain || null,
          website,
          email_context: emailContext,
          email_context_updated_at: nowIso,
          profile: {
            email_context_source_hash: sourceHash,
            email_last_message_id: msgs[0]?.id || null,
            email_last_message_at: msgs[0]?.date || null,
            email_context_counterparty_email: counterparty,
            email_context_counterparty_domain: domain || null,
          },
          ...privateRecordFields(scope),
        })
        .select("id")
        .single();
      if (insertCompanyError) throw insertCompanyError;
      if (!ins?.id) throw new Error("The client profile was not created");
      targetId = ins?.id as string;
      created = true;
    }

    // Make sure the person is filed under their own organisation (once). Email
    // context can legitimately be relevant to a different client, but that
    // must not turn an internal coordinator into the client's employee.
    let contactCompanyId: string | null = targetId;
    if (explicitTarget && targetId && isCompanyDomain && domain) {
      const targetDomain = normaliseCompanyDomain(
        targetCompany?.domain || targetCompany?.website
      );
      if (targetDomain !== normaliseCompanyDomain(domain)) {
        const naturalCompany = await resolveExistingCompany({ domain });
        contactCompanyId = naturalCompany?.id || null;
      }
    }
    if (contactCompanyId && counterparty) {
      const { data: existingCt } = await supabaseAdmin
        .from("contacts")
        .select("id")
        .eq("company_id", contactCompanyId)
        .ilike("email", counterparty)
        .limit(1);
      if (!existingCt || !existingCt.length) {
        const { data: savedContact, error: saveContactError } = await supabaseAdmin
          .from("contacts")
          .insert({
            company_id: contactCompanyId,
            name: personName || counterparty,
            email: counterparty,
            ...privateRecordFields(scope),
          })
          .select("id")
          .single();
        if (saveContactError) throw saveContactError;
        if (!savedContact?.id) throw new Error("The contact was not created");
      }
    }

    return NextResponse.json({
      ok: true,
      companyId: targetId,
      workstreamId: workstream?.id || null,
      name: companyName,
      person: personName,
      email: counterparty,
      created,
      messages: msgs.length,
      emailContext,
      emailContextUpdatedAt: nowIso,
    });
  } catch (err: any) {
    console.error("Email pull failed", err?.message || err);
    return NextResponse.json(
      crmBlockerPayload({
        code: "email_pull_not_confirmed",
        title: "Email history not saved",
        reason: "LiveCoach could not confirm the mailbox summary and CRM updates",
        nextAction: "Refresh the client and try once more. If it repeats, send this blocker code to a workspace owner",
        responsible: "system",
      }),
      { status: 500 }
    );
  }
}
