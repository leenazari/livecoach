import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { upsertTasks, actionToLinkKind } from "@/lib/tasks";
import { logModelUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 45;
export const dynamic = "force-dynamic";

// CROSS-CALL INTELLIGENCE.
// One call almost always touches more than its own client: a board call sets the
// position on a partner, a client call references another live deal. Today the
// system only ever processes a call against its OWN client, so what a call says
// about a DIFFERENT client is lost. This reads a finished call's summary, finds
// the user's OTHER known clients that were MATERIALLY discussed, and pushes the
// relevant intel and next actions onto THOSE clients - so the next prep for any
// of them already carries what this call said about them.
//
// Conservative by design: substance only (a real decision, position, commitment,
// risk or development), never passing mentions, never the call's own client,
// never invented. Best-effort, always returns 200.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) return NextResponse.json({ links: [] });

    const { data: sum } = await supabaseAdmin
      .from("interview_summaries")
      .select("company_id, candidate, summary, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sum?.summary) return NextResponse.json({ links: [] });
    const s: any = sum.summary;

    const { data: companies } = await supabaseAdmin
      .from("companies")
      .select("id, name, profile");
    // Never the call's own client - its brief is handled by its own synthesis.
    const list = (companies || []).filter((c: any) => c.id !== sum.company_id);
    if (!list.length) return NextResponse.json({ links: [] });

    // Grounded input: the SUMMARY, not the raw transcript, so it can't drift.
    const briefIn = [
      s.overview ? `OVERVIEW: ${s.overview}` : "",
      Array.isArray(s.concerns) && s.concerns.length
        ? `CONCERNS: ${s.concerns.join(" | ")}`
        : "",
      Array.isArray(s.myNextActions) && s.myNextActions.length
        ? `MY NEXT ACTIONS: ${s.myNextActions.join(" | ")}`
        : "",
      Array.isArray(s.suggestedNextActions) && s.suggestedNextActions.length
        ? `SUGGESTED: ${s.suggestedNextActions.join(" | ")}`
        : "",
      Array.isArray(s.theirNextActions) && s.theirNextActions.length
        ? `THEIR NEXT ACTIONS: ${s.theirNextActions.join(" | ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (!briefIn.trim()) return NextResponse.json({ links: [] });

    const names = list.map((c: any) => c.name).filter(Boolean);

    const system = `You connect a call to the user's OTHER clients and deals. You are given a summary of ONE call plus a list of the user's known clients. Identify ONLY clients from the list that were MATERIALLY discussed in this call - a real decision, position, commitment, risk or development about them - never a passing mention and never the call's own client. For each, return a short intel note (2 to 3 sentences, what this call means for that client or relationship, grounded strictly in the summary, no invention) and any concrete next actions for that client.
Output ONLY JSON: {"links":[{"client":"<exact name copied from the list>","intel":"...","actions":[{"text":"<short imperative under 12 words>","action":"email|call|task"}]}]}.
If no other client was materially discussed, return {"links":[]}. Be conservative: when in doubt, leave it out. House style: never use em dashes or semicolons.`;

    const user = `THIS CALL'S OWN CLIENT (exclude it): ${
      sum.candidate || "(internal / unknown)"
    }
KNOWN CLIENTS (use these EXACT names): ${names.join(", ")}

CALL SUMMARY:
${briefIn}

Return the JSON now.`;

    const msg: any = await anthropic.messages.create({
      model: CLAUDE_MODEL_PRO,
      max_tokens: 1500,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }],
    });
    await logModelUsage("cross-link", "sonnet", msg?.usage);
    const raw = (Array.isArray(msg?.content) ? msg.content : [])
      .filter((b: any) => b && b.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("");
    let links: any[] = [];
    try {
      const a = raw.indexOf("{");
      const z = raw.lastIndexOf("}");
      const parsed = a >= 0 && z > a ? JSON.parse(raw.slice(a, z + 1)) : {};
      links = Array.isArray(parsed.links) ? parsed.links : [];
    } catch {
      links = [];
    }
    if (!links.length) return NextResponse.json({ links: [] });

    // Resolve client names (and aliases) back to ids.
    const byName = new Map<string, any>();
    for (const c of list) {
      byName.set(String(c.name || "").toLowerCase().trim(), c);
      const al = Array.isArray((c.profile || {}).aliases)
        ? (c.profile as any).aliases
        : [];
      for (const a of al) byName.set(String(a || "").toLowerCase().trim(), c);
    }

    const when = sum.created_at
      ? new Date(sum.created_at).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
        })
      : "";
    const fromLabel = sum.candidate ? `call with ${sum.candidate}` : "a recent call";

    const applied: string[] = [];
    for (const link of links) {
      const c = byName.get(String(link?.client || "").toLowerCase().trim());
      if (!c) continue;

      // Append the intel onto that client's brief, dated and attributed, so the
      // next prep for them surfaces it. Never clobber the existing brief.
      const intel = typeof link.intel === "string" ? link.intel.trim() : "";
      if (intel) {
        try {
          const { data: comp } = await supabaseAdmin
            .from("companies")
            .select("profile")
            .eq("id", c.id)
            .maybeSingle();
          const profile = { ...((comp as any)?.profile || {}) };
          const note = `FROM ${fromLabel}${when ? ` (${when})` : ""}: ${intel}`;
          profile.brief = `${
            profile.brief ? String(profile.brief).trim() + "\n\n" : ""
          }${note}`;
          profile.updated = new Date().toISOString();
          await supabaseAdmin
            .from("companies")
            .update({ profile })
            .eq("id", c.id);
        } catch {
          /* best-effort */
        }
      }

      // Push the next actions onto that client as tasks (deduped by lib/tasks).
      const items = (Array.isArray(link.actions) ? link.actions : [])
        .filter((x: any) => x && typeof x.text === "string" && x.text.trim())
        .slice(0, 6)
        .map((x: any) => ({
          text: x.text.trim(),
          linkKind: actionToLinkKind(x.action),
          source: "cross-link",
          sourceRef: sessionId,
        }));
      if (items.length) {
        try {
          await upsertTasks(c.id, items);
        } catch {
          /* best-effort */
        }
      }
      applied.push(c.name);
    }

    return NextResponse.json({ links: applied });
  } catch (err: any) {
    return NextResponse.json({ links: [], error: err?.message }, { status: 200 });
  }
}
