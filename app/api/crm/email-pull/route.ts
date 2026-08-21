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
  gmailConnected,
} from "@/lib/gmail";
import { googleConnected } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

// PULL A CONTACT'S EMAIL AND BUILD A CLIENT FROM IT. Given a person (name or
// email) or a company, this reads the recent Gmail thread with them, distils it
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
  const set = new Set<string>([
    "lee@interviewa.com",
    "lee@ai13.com",
    "lee.nazari@gmail.com",
  ]);
  try {
    const connection = await googleConnected();
    if (connection.email) set.add(connection.email.toLowerCase());
  } catch {
    /* best-effort */
  }
  return set;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    let email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const companyId =
      typeof body.companyId === "string" ? body.companyId.trim() : "";
    const requestedWorkstreamId =
      typeof body.workstreamId === "string" ? body.workstreamId.trim() : "";
    const workstream = requestedWorkstreamId
      ? await getWorkstreamScope(requestedWorkstreamId)
      : null;
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

    // If we were handed a company, search its recorded contact / domain.
    if (!email && !name && !query && companyId) {
      const { data: co } = await supabaseAdmin
        .from("companies")
        .select("name, domain")
        .eq("id", companyId)
        .maybeSingle();
      const { data: ct } = await supabaseAdmin
        .from("contacts")
        .select("email")
        .eq("company_id", companyId)
        .not("email", "is", null)
        .limit(1);
      email = (ct && ct[0]?.email ? String(ct[0].email) : "").toLowerCase();
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
        { error: "give me a name, an email or a client to pull" },
        { status: 400 }
      );
    }

    // For an existing client, load the rolling summary before touching Gmail.
    // The newest processed message id lets subsequent refreshes use only the
    // new message bodies instead of paying to resend the old conversation.
    const { data: cachedCompany } = companyId
      ? await supabaseAdmin
          .from("companies")
          .select("name, profile, email_context, email_context_updated_at")
          .eq("id", companyId)
          .maybeSingle()
      : { data: null };
    const { data: cachedThread } = workstream
      ? await supabaseAdmin
          .from("workstreams")
          .select("email_context, email_context_updated_at, email_context_meta")
          .eq("id", workstream.id)
          .maybeSingle()
      : { data: null };

    const msgs = await recentMessages(query, 25);
    if (!msgs.length) {
      const connected = await gmailConnected();
      return NextResponse.json(
        {
          error: connected
            ? "no emails found for that, or Gmail read is not granted yet. Re-connect Google in Settings so it can read mail."
            : "Google is not connected. Connect it in Settings (with Gmail) first.",
        },
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
        if (msgs[0]?.date) {
          const emailMeta = {
            ...(profile || {}),
            email_last_message_id: msgs[0]?.id || null,
            email_last_message_at: msgs[0].date,
          };
          if (workstream) {
            await supabaseAdmin
              .from("workstreams")
              .update({
                email_context_meta: emailMeta,
                updated_at: new Date().toISOString(),
              })
              .eq("id", workstream.id);
          } else {
            await supabaseAdmin
              .from("companies")
              .update({ profile: emailMeta })
              .eq("id", companyId);
          }
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
        system: `You maintain a short, clean CLIENT CONTEXT note for a CRM. The user is Lee (Interviewa / AI13). Write about the OTHER party (${personName}${
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
      const emailMeta = {
        ...((workstream
          ? (cachedThread as any)?.email_context_meta
          : existingCompany?.profile) || {}),
        email_context_source_hash: sourceHash,
        email_last_message_id: msgs[0]?.id || null,
        email_last_message_at: msgs[0]?.date || null,
      };
      const patch: Record<string, any> = workstream
        ? { updated_at: nowIso }
        : {
            email_context: emailContext,
            email_context_updated_at: nowIso,
            updated_at: nowIso,
            profile: emailMeta,
          };
      // Pulling an internal or cross-relationship email into a client's
      // context must never replace that client's own identity. Only an
      // automatically resolved record may have a missing domain filled here.
      if (!explicitTarget && website && !existingCompany?.website) patch.website = website;
      if (!explicitTarget && domain && !existingCompany?.domain) patch.domain = domain;
      await supabaseAdmin.from("companies").update(patch).eq("id", targetId);
      if (workstream) {
        await supabaseAdmin
          .from("workstreams")
          .update({
            email_context: emailContext,
            email_context_updated_at: nowIso,
            email_context_meta: emailMeta,
            updated_at: nowIso,
          })
          .eq("id", workstream.id)
          .eq("company_id", targetId);
      }
    } else {
      const { data: ins } = await supabaseAdmin
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
          },
        })
        .select("id")
        .single();
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
        await supabaseAdmin.from("contacts").insert({
          company_id: contactCompanyId,
          name: personName || counterparty,
          email: counterparty,
        });
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
    return NextResponse.json(
      { error: err?.message || "failed to pull the email" },
      { status: 500 }
    );
  }
}
