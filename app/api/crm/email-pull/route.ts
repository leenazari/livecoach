import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";
import { logModelUsage } from "@/lib/usage";
import {
  recentMessages,
  digestMessages,
  emailFromHeader,
  nameFromHeader,
  gmailConnected,
} from "@/lib/gmail";

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
    const { data } = await supabaseAdmin
      .from("google_oauth")
      .select("email")
      .eq("id", "main")
      .maybeSingle();
    if (data?.email) set.add(String(data.email).toLowerCase());
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

    const msgs = await recentMessages(query, 15);
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

    // Distil the thread into a clean context note + a company name.
    const digest = digestMessages(msgs, 12);
    let emailContext = "";
    let companyName = "";
    try {
      const msg = await anthropic.messages.create({
        model: CLAUDE_MODEL_LIVE,
        max_tokens: 600,
        system: `You turn a recent email thread into a short, clean CLIENT CONTEXT note for a CRM. The user is Lee (Interviewa / AI13). Write about the OTHER party (${personName}${
          isCompanyDomain ? `, ${domain}` : ""
        }). Output ONLY JSON: {"companyName": "the org name to file them under (their company if it is a business, else their name)", "emailContext": "3 to 6 plain sentences: who they are, what the relationship is about, where it is up to, and the next step. Ground it only in the thread."}. No markdown, no em-dashes or semicolons.`,
        messages: [
          {
            role: "user",
            content: `OTHER PARTY: ${personName} <${counterparty}>${
              isCompanyDomain ? `\nCompany domain: ${domain}` : ""
            }\n\nRECENT EMAIL THREAD (newest first):\n${digest}\n\nReturn the JSON.`,
          },
        ],
      });
      await logModelUsage("email-pull", "haiku", (msg as any).usage);
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
    let targetId = companyId;
    if (!targetId && isCompanyDomain) {
      const { data: byDomain } = await supabaseAdmin
        .from("companies")
        .select("id")
        .eq("domain", domain)
        .limit(1);
      if (byDomain && byDomain[0]) targetId = byDomain[0].id as string;
    }
    let created = false;
    if (targetId) {
      const patch: Record<string, any> = {
        email_context: emailContext,
        email_context_updated_at: nowIso,
        updated_at: nowIso,
      };
      if (website) patch.website = website;
      if (domain) patch.domain = domain;
      await supabaseAdmin.from("companies").update(patch).eq("id", targetId);
    } else {
      const { data: ins } = await supabaseAdmin
        .from("companies")
        .insert({
          name: companyName,
          domain: domain || null,
          website,
          email_context: emailContext,
          email_context_updated_at: nowIso,
        })
        .select("id")
        .single();
      targetId = ins?.id as string;
      created = true;
    }

    // Make sure the person is on file as a contact (once).
    if (targetId && counterparty) {
      const { data: existingCt } = await supabaseAdmin
        .from("contacts")
        .select("id")
        .eq("company_id", targetId)
        .ilike("email", counterparty)
        .limit(1);
      if (!existingCt || !existingCt.length) {
        await supabaseAdmin.from("contacts").insert({
          company_id: targetId,
          name: personName || counterparty,
          email: counterparty,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      companyId: targetId,
      name: companyName,
      person: personName,
      email: counterparty,
      created,
      messages: msgs.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to pull the email" },
      { status: 500 }
    );
  }
}
