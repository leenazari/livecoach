import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";
import { logModelUsage } from "@/lib/usage";
import { sendMail, connectedEmail } from "@/lib/gmail";
import {
  buildSpeakerMap,
  canonicalName,
  loadHostIdentity,
} from "@/lib/speakers";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// THE DAILY DIGEST.
//
// One email at the end of the day covering every call that finished, with the
// actions grouped by who owns them. Fired by a Vercel cron (see vercel.json).
//
// Why daily and not two minutes after each call: Vercel's Hobby plan caps cron
// at ONCE PER DAY and fails the deployment outright for anything more frequent.
// A daily digest is the schedule that works without a plan upgrade. If you move
// to Pro, the same route can be pointed at a tighter schedule.
//
// Cost: ONE Sonnet call for the whole day, over summaries that were already
// generated and paid for when each call ended. Nothing is re-summarised.
//
// House style: no em dashes, no semicolons.

const esc = (s: any): string =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

type Action = { owner: string; text: string };
type CallBlock = {
  ref: string;
  title: string;
  company: string;
  summaryLine: string;
  sections: { heading: string; body: string }[];
  actions: Action[];
  notes: string;
};

export async function GET(req: NextRequest) {
  // The cron endpoint is a public URL, so it is gated on a shared secret.
  // Vercel sends CRON_SECRET as a bearer token on scheduled invocations.
  const secret = process.env.CRON_SECRET || "";
  const auth = req.headers.get("authorization") || "";
  const manual = new URL(req.url).searchParams.get("key") || "";
  if (secret && auth !== `Bearer ${secret}` && manual !== secret) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }

  try {
    // ---- Which calls finished today ---------------------------------------
    // Local-day window. Cron fires in UTC and Hobby precision is plus or minus
    // an hour, so we take the last 24 hours rather than a calendar day, which
    // is both simpler and immune to the timing slop.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: rows } = await supabaseAdmin
      .from("interview_summaries")
      .select("ref, session_id, candidate, role, summary, created_at, company_id")
      .gte("created_at", since)
      .order("created_at", { ascending: true });

    const summaries = (rows || []).filter(
      (r: any) => r && r.summary && typeof r.summary === "object"
    );

    if (!summaries.length) {
      return NextResponse.json({ ok: true, skipped: "no calls today" });
    }

    // ---- Who was on each call, with names collapsed onto one person --------
    const sessionIds = summaries
      .map((r: any) => r.session_id)
      .filter((x: any) => typeof x === "string" && x);

    let speakerLabels: string[] = [];
    if (sessionIds.length) {
      const { data: utt } = await supabaseAdmin
        .from("meet_utterances")
        .select("speaker")
        .in("session_id", sessionIds);
      speakerLabels = (utt || [])
        .map((u: any) => u.speaker)
        .filter((s: any) => typeof s === "string" && s.trim());
    }

    const host = await loadHostIdentity();
    const map = buildSpeakerMap(speakerLabels, host.name);

    // Every distinct human on today's calls, canonical spelling only. This is
    // the list the model is allowed to assign actions to.
    const people = Array.from(
      new Set(speakerLabels.map((l) => canonicalName(map, l)).filter(Boolean))
    );

    // ---- Company names for the headings ------------------------------------
    const companyIds = Array.from(
      new Set(summaries.map((r: any) => r.company_id).filter(Boolean))
    );
    const companyName = new Map<string, string>();
    if (companyIds.length) {
      const { data: cos } = await supabaseAdmin
        .from("companies")
        .select("id, name")
        .in("id", companyIds);
      for (const c of cos || []) companyName.set(c.id, c.name || "");
    }

    // ---- Build the model input from what was ALREADY generated -------------
    const dayInput = summaries
      .map((r: any, i: number) => {
        const s = r.summary || {};
        const notes =
          typeof s.userNotes === "string" && s.userNotes.trim()
            ? s.userNotes.trim()
            : "";
        return [
          `## CALL ${i + 1} (${r.ref || "no ref"})`,
          `Client: ${companyName.get(r.company_id) || "unknown"}`,
          `Other party: ${r.candidate || "unknown"}`,
          r.role ? `Role in play: ${r.role}` : "",
          s.recommendation ? `Read: ${s.recommendation}` : "",
          Array.isArray(s.strengths) && s.strengths.length
            ? `What went well:\n${s.strengths.map((x: any) => `- ${x}`).join("\n")}`
            : "",
          Array.isArray(s.concerns) && s.concerns.length
            ? `Concerns:\n${s.concerns.map((x: any) => `- ${x}`).join("\n")}`
            : "",
          Array.isArray(s.contributors) && s.contributors.length
            ? `Who was involved:\n${s.contributors
                .map((c: any) => `- ${c?.name}: ${c?.note || ""}`)
                .join("\n")}`
            : "",
          Array.isArray(s.privateNotes) && s.privateNotes.length
            ? `Private notes:\n${s.privateNotes.map((x: any) => `- ${x}`).join("\n")}`
            : "",
          notes ? `YOUR OWN NOTES ON THIS CALL (weight these heavily):\n${notes}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");

    const system = `You write a short end-of-day digest of the calls someone had today. You are writing TO that person, so address them as "you".

You are given summaries that were already produced at the end of each call. Work only from them. Do not invent anything that is not there.

THE PEOPLE ON TODAY'S CALLS, use these EXACT spellings and no others:
${people.length ? people.map((p) => `- ${p}`).join("\n") : "- (no speaker names captured)"}
The person you are writing to is ${host.name || "the host"}. Their actions are theirs, do not hand them to a client.

For EVERY action item you must name an owner from that list. If the summary genuinely does not say who owns something, set owner to "Unassigned". NEVER guess an owner. An action pinned to the wrong person is worse than one marked unassigned, because they will chase someone for a commitment that person never made.

Output ONLY valid JSON, no markdown fences:
{
  "headline": "one plain sentence on what today amounted to",
  "calls": [
    {
      "ref": "the call ref exactly as given",
      "summaryLine": "one sentence on what this call established",
      "sections": [{"heading": "short theme heading", "body": "two or three plain sentences"}],
      "actions": [{"owner": "a name from the list, or Unassigned", "text": "a short imperative starting with a verb"}]
    }
  ]
}

Rules:
- 1 to 3 sections per call. Skip a section rather than padding it.
- Actions are specific and short, under 15 words, starting with a verb.
- British English, plain and direct. No flattery, no jargon, no bold, no markdown.
- Never use em dashes or semicolons, use commas and full stops.`;

    const msg: any = await anthropic.messages.create({
      model: CLAUDE_MODEL_PRO,
      max_tokens: 2500,
      system,
      messages: [
        {
          role: "user",
          content: `Today's calls:\n\n${dayInput}\n\nReturn the digest JSON now.`,
        },
      ],
    });
    await logModelUsage("daily-digest", "sonnet", msg?.usage);

    const text = (Array.isArray(msg?.content) ? msg.content : [])
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("");

    let out: any = {};
    try {
      const a = text.indexOf("{");
      const z = text.lastIndexOf("}");
      if (a >= 0 && z > a) out = JSON.parse(text.slice(a, z + 1));
    } catch {
      return NextResponse.json(
        { ok: false, error: "the digest came back unparseable" },
        { status: 500 }
      );
    }

    // ---- Stitch the model output back onto the real rows -------------------
    const byRef = new Map<string, any>();
    for (const r of summaries) byRef.set(String(r.ref || ""), r);

    const blocks: CallBlock[] = (Array.isArray(out.calls) ? out.calls : []).map(
      (c: any) => {
        const row = byRef.get(String(c?.ref || "")) || {};
        return {
          ref: String(c?.ref || row.ref || ""),
          title: row.candidate || "Call",
          company: companyName.get(row.company_id) || "",
          summaryLine: String(c?.summaryLine || ""),
          sections: (Array.isArray(c?.sections) ? c.sections : [])
            .map((s: any) => ({
              heading: String(s?.heading || ""),
              body: String(s?.body || ""),
            }))
            .filter((s: any) => s.heading && s.body),
          actions: (Array.isArray(c?.actions) ? c.actions : [])
            .map((a: any) => ({
              owner: String(a?.owner || "Unassigned").trim() || "Unassigned",
              text: String(a?.text || "").trim(),
            }))
            .filter((a: Action) => a.text),
          notes:
            typeof row?.summary?.userNotes === "string"
              ? row.summary.userNotes.trim()
              : "",
        };
      }
    );

    if (!blocks.length) {
      return NextResponse.json({ ok: false, error: "digest had no calls" });
    }

    // ---- Actions grouped by owner, across the whole day --------------------
    const byOwner = new Map<string, string[]>();
    for (const b of blocks) {
      for (const a of b.actions) {
        const list = byOwner.get(a.owner) || [];
        list.push(a.text);
        byOwner.set(a.owner, list);
      }
    }
    // You first, Unassigned last, everyone else in between.
    const owners = Array.from(byOwner.keys()).sort((x, y) => {
      if (x === host.name) return -1;
      if (y === host.name) return 1;
      if (x === "Unassigned") return 1;
      if (y === "Unassigned") return -1;
      return x.localeCompare(y);
    });

    const when = new Date().toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const html = renderEmail({
      when,
      headline: String(out.headline || ""),
      blocks,
      owners,
      byOwner,
      hostName: host.name,
    });

    const to = await connectedEmail();
    if (!to) {
      return NextResponse.json({
        ok: false,
        error: "no connected Google account to send to",
      });
    }

    const sent = await sendMail({
      to,
      subject: `LiveCoach: your calls on ${when}`,
      html,
    });

    return NextResponse.json({
      ok: sent.ok,
      calls: blocks.length,
      actions: Array.from(byOwner.values()).reduce((n, l) => n + l.length, 0),
      to,
      error: sent.error,
    });
  } catch (err: any) {
    console.error("daily digest failed:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "digest failed" },
      { status: 500 }
    );
  }
}

// Inline styles only. Every email client strips <style> blocks, and half of
// them strip classes too, so anything not inline will not survive.
function renderEmail(d: {
  when: string;
  headline: string;
  blocks: CallBlock[];
  owners: string[];
  byOwner: Map<string, string[]>;
  hostName: string;
}): string {
  const wrap = (inner: string) => `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f4f1;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f1;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e3e0da;border-radius:10px;">
<tr><td style="padding:28px 30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1b19;">
${inner}
</td></tr></table>
</td></tr></table>
</body></html>`;

  const callHtml = d.blocks
    .map(
      (b) => `
  <div style="margin:0 0 26px 0;padding:0 0 22px 0;border-bottom:1px solid #eeece7;">
    <p style="margin:0 0 2px 0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8a857c;">
      ${esc(b.ref)}${b.company ? ` &middot; ${esc(b.company)}` : ""}
    </p>
    <h3 style="margin:0 0 8px 0;font-size:17px;font-weight:600;color:#1c1b19;">${esc(b.title)}</h3>
    ${
      b.summaryLine
        ? `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.55;color:#3c3832;">${esc(b.summaryLine)}</p>`
        : ""
    }
    ${b.sections
      .map(
        (s) => `
      <p style="margin:0 0 3px 0;font-size:13px;font-weight:600;color:#1c1b19;">${esc(s.heading)}</p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:#4a453d;">${esc(s.body)}</p>`
      )
      .join("")}
    ${
      b.notes
        ? `<div style="margin:12px 0 0 0;padding:10px 12px;background:#fbf8f0;border-left:3px solid #c9a227;">
             <p style="margin:0 0 3px 0;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8a857c;">your notes</p>
             <p style="margin:0;font-size:14px;line-height:1.55;color:#4a453d;white-space:pre-wrap;">${esc(b.notes)}</p>
           </div>`
        : ""
    }
  </div>`
    )
    .join("");

  const actionsHtml = d.owners
    .map((owner) => {
      const mine = owner === d.hostName;
      const items = (d.byOwner.get(owner) || [])
        .map(
          (t) =>
            `<li style="margin:0 0 5px 0;font-size:14px;line-height:1.5;color:#4a453d;">${esc(t)}</li>`
        )
        .join("");
      return `
      <div style="margin:0 0 16px 0;">
        <p style="margin:0 0 6px 0;font-size:13px;font-weight:600;color:${
          mine ? "#9a7b12" : "#1c1b19"
        };">${esc(owner)}${mine ? " (you)" : ""}</p>
        <ul style="margin:0;padding:0 0 0 18px;">${items}</ul>
      </div>`;
    })
    .join("");

  return wrap(`
    <p style="margin:0 0 3px 0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8a857c;">LiveCoach</p>
    <h1 style="margin:0 0 6px 0;font-size:21px;font-weight:600;color:#1c1b19;">Your calls on ${esc(d.when)}</h1>
    ${
      d.headline
        ? `<p style="margin:0 0 24px 0;font-size:15px;line-height:1.55;color:#4a453d;">${esc(d.headline)}</p>`
        : ""
    }
    ${callHtml}
    <h2 style="margin:6px 0 14px 0;font-size:16px;font-weight:600;color:#1c1b19;">Who is doing what</h2>
    ${actionsHtml || '<p style="font-size:14px;color:#8a857c;">No actions came out of today.</p>'}
    <p style="margin:26px 0 0 0;font-size:12px;line-height:1.5;color:#8a857c;">
      Written by LiveCoach from the call summaries. It can get things wrong, so check anything that matters before acting on it.
    </p>
  `);
}
