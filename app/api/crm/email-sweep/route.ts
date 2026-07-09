import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { recentMessages, emailFromHeader } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// AUTO-CREATE CLIENTS FROM SENT EMAIL. Scans the user's recent SENT mail, finds
// people they are emailing from real COMPANY addresses who are not in the CRM
// yet, and creates each as a client with context (via the email-pull engine),
// so anyone the user is corresponding with is set up ahead of a meeting. Safe:
// skips personal inboxes, the user's own orgs and configured internal domains,
// dedupes against existing contacts/companies, and caps the work per run.
// Run on a schedule (pg_cron) and idempotent, so it can run often.

const PERSONAL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "aol.com", "proton.me",
  "protonmail.com", "gmx.com", "msn.com", "btinternet.com",
]);

async function run(req: Request) {
  try {
    const origin = new URL(req.url).origin;

    // Skip the user's own orgs + any internal domains they have configured.
    const internal = new Set<string>(["ai13.com", "interviewa.com"]);
    try {
      const { data } = await supabaseAdmin
        .from("workspace_profile")
        .select("internal_domains")
        .eq("id", "main")
        .maybeSingle();
      const arr = Array.isArray((data as any)?.internal_domains)
        ? (data as any).internal_domains
        : [];
      for (const d of arr)
        if (typeof d === "string")
          internal.add(d.toLowerCase().replace(/^@/, "").trim());
    } catch {
      /* best-effort */
    }

    const sent = await recentMessages("in:sent newer_than:21d", 25);
    if (!sent.length) {
      return NextResponse.json({
        scanned: 0,
        created: 0,
        note: "no sent mail found, or Gmail read not granted (reconnect Google)",
      });
    }

    // Candidate external company contacts from the recipients of sent mail.
    const cand = new Map<string, number>();
    for (const m of sent) {
      for (const h of [m.to, m.cc]) {
        for (const part of String(h || "").split(",")) {
          const e = emailFromHeader(part);
          if (!e) continue;
          const dom = (e.split("@")[1] || "").toLowerCase();
          if (!dom || PERSONAL.has(dom) || internal.has(dom)) continue;
          cand.set(e, (cand.get(e) || 0) + 1);
        }
      }
    }
    if (!cand.size) {
      return NextResponse.json({ scanned: sent.length, created: 0 });
    }

    // Who is already in the CRM (by contact email or company domain)?
    const [{ data: cts }, { data: cos }] = await Promise.all([
      supabaseAdmin.from("contacts").select("email").not("email", "is", null).limit(3000),
      supabaseAdmin.from("companies").select("domain").not("domain", "is", null).limit(3000),
    ]);
    const haveEmail = new Set(
      (cts || []).map((c: any) => String(c.email || "").toLowerCase())
    );
    const haveDomain = new Set(
      (cos || []).map((c: any) => String(c.domain || "").toLowerCase())
    );

    const toCreate = [...cand.keys()]
      .filter((e) => !haveEmail.has(e))
      .filter((e) => !haveDomain.has((e.split("@")[1] || "").toLowerCase()))
      .sort((a, b) => (cand.get(b) || 0) - (cand.get(a) || 0))
      .slice(0, 3); // cap per run; the rest are caught next run

    let created = 0;
    const done: string[] = [];
    for (const email of toCreate) {
      try {
        const r = await fetch(`${origin}/api/crm/email-pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (r.ok) {
          const d = await r.json();
          if (d?.ok && d?.created) {
            created++;
            done.push(email);
          }
        }
      } catch {
        /* skip - next run retries */
      }
    }

    return NextResponse.json({
      scanned: sent.length,
      candidates: cand.size,
      created,
      done,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "email sweep failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
