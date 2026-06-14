import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";
import { gatherClientContext } from "@/lib/crm-context";
import { upsertTasks } from "@/lib/tasks";

export const runtime = "nodejs";
export const maxDuration = 40;

// THE SYNTHESIS ENGINE. Turns everything we know about a client (calls, notes,
// pulled emails, opportunities) into their working intelligence in one Sonnet
// pass: an updated "what we know" brief, a strategic playbook, the open
// opportunities, and a concrete next-steps to-do list. Unlike the post-call
// pass it does NOT need a call - it runs off the client's whole context, so it
// works the moment you've pulled emails or added notes. Re-runnable.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const companyId = params.id;
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name, profile")
      .eq("id", companyId)
      .single();
    if (!company) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }

    const context = await gatherClientContext(companyId);
    if (!context || context.trim().length < 20) {
      return NextResponse.json(
        { error: "not enough context yet - add notes, emails or a call first" },
        { status: 422 }
      );
    }

    const existing = (company.profile || {}) as any;
    const existingBriefStr = Array.isArray(existing.brief)
      ? existing.brief.join("\n")
      : String(existing.brief || "");

    const system = `You build a client's working intelligence from EVERYTHING known about them (calls, notes, pulled emails, opportunities) - provided below. Output ONLY JSON with exactly these keys:

{
  "brief": [ "the running 'what we know' profile as a SCANNABLE BULLET LIST - one short bullet per distinct subject, person or thread (who they are, what they want, the state of play, open threads). Group by subject or contact so it never reads as a paragraph. Each bullet is one line, lead with the subject or name where it helps (e.g. 'Alain / KIN: ...'). 3-8 bullets. Merge with the existing brief if given." ],
  "playbook": [ "3-6 short, ordered strategic plays - the main moves to advance THIS client toward the outcome the host wants. Specific to this client and the open threads, most important first. Not generic advice." ],
  "opportunities": [ { "title": "short name for a concrete opportunity FOR US", "detail": "one line grounding it in the context", "value": <rough GBP number or null> } ],
  "nextSteps": [ { "text": "a concrete to-do, short action line (who to contact, what to send, what to decide)", "action": "one of: email (write/send a message), call (prep for or make a call/meeting), task (anything else)" } ]
}

Rules:
- Ground EVERYTHING only in the context below. Never invent facts, names, numbers, dates or commitments. If something isn't there, leave it out.
- Write in plain English. No markdown, no "#" headings, no "**bold**". No em-dashes or semicolons - use commas and full stops.
- opportunities: 0-4, only real ones clearly implied. Empty array if none. value is a rough number or null, never a string.
- nextSteps: real and actionable, drawn from the open threads in the context. action must be exactly one of "email", "call", "task". If genuinely none, return an empty array.`;

    const userMsg = `CLIENT: ${company.name}

EXISTING BRIEF (may be empty):
${existingBriefStr || "(none yet)"}

EVERYTHING WE KNOW (calls, notes, emails, opportunities):
${context}

Return the JSON now.`;

    let brief: string[] = Array.isArray(existing.brief)
      ? existing.brief
      : existingBriefStr
      ? [existingBriefStr]
      : [];
    let playbook: string[] = Array.isArray(existing.playbook)
      ? existing.playbook
      : [];
    let nextSteps: { text: string; action: string }[] = [];
    let opportunities: { title: string; detail: string; value: number | null }[] =
      [];

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 34000);
      try {
        const msg = await anthropic.messages.create(
          {
            model: CLAUDE_MODEL_PRO,
            max_tokens: 1300,
            temperature: 0.3,
            system,
            messages: [{ role: "user", content: userMsg }],
          },
          { signal: controller.signal }
        );
        const raw = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("")
          .replace(/```json|```/g, "")
          .trim();
        const a = raw.indexOf("{");
        const b = raw.lastIndexOf("}");
        const parsed = a >= 0 && b > a ? JSON.parse(raw.slice(a, b + 1)) : null;
        if (parsed) {
          if (Array.isArray(parsed.brief)) {
            const bb = parsed.brief
              .filter((p: any) => typeof p === "string" && p.trim())
              .map((p: string) => p.replace(/^[-•*]\s*/, "").trim())
              .slice(0, 8);
            if (bb.length) brief = bb;
          } else if (typeof parsed.brief === "string" && parsed.brief.trim()) {
            // Model returned a paragraph - split into bullets defensively.
            brief = parsed.brief
              .split(/\n+/)
              .map((s: string) => s.replace(/^[-•*]\s*/, "").trim())
              .filter(Boolean)
              .slice(0, 8);
          }
          if (Array.isArray(parsed.playbook)) {
            const pb = parsed.playbook
              .filter((p: any) => typeof p === "string" && p.trim())
              .map((p: string) => p.trim())
              .slice(0, 6);
            if (pb.length) playbook = pb;
          }
          if (Array.isArray(parsed.nextSteps)) {
            nextSteps = parsed.nextSteps
              .map((s: any) => {
                if (typeof s === "string" && s.trim())
                  return { text: s.trim(), action: "task" };
                if (s && typeof s.text === "string" && s.text.trim()) {
                  const a = ["email", "call", "task"].includes(s.action)
                    ? s.action
                    : "task";
                  return { text: String(s.text).trim(), action: a };
                }
                return null;
              })
              .filter((x: any): x is { text: string; action: string } => !!x)
              .slice(0, 6);
          }
          if (Array.isArray(parsed.opportunities)) {
            opportunities = parsed.opportunities
              .filter((o: any) => o && typeof o.title === "string" && o.title.trim())
              .slice(0, 4)
              .map((o: any) => ({
                title: String(o.title).trim(),
                detail: typeof o.detail === "string" ? o.detail.trim() : "",
                value: typeof o.value === "number" ? o.value : null,
              }));
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      console.error("Synthesis pass failed:", e);
      return NextResponse.json(
        { error: "the synthesis took too long - try again" },
        { status: 504 }
      );
    }

    await supabaseAdmin
      .from("companies")
      .update({
        profile: {
          ...existing,
          brief,
          playbook,
          updated: new Date().toISOString(),
        },
      })
      .eq("id", companyId);

    // Next steps become real, trackable tasks (deduped by fingerprint, so
    // completed ones are never recreated when this is re-run).
    await upsertTasks(
      companyId,
      nextSteps.map((s) => ({
        text: s.text,
        kind: "next_step",
        linkKind: s.action, // email | call | task -> drives the click action
        source: "synthesis",
      }))
    );

    // Idempotent: replace only the context-synthesised opportunities (AI-
    // surfaced, not tied to a specific call), leaving call-derived ones alone.
    await supabaseAdmin
      .from("opportunities")
      .delete()
      .eq("company_id", companyId)
      .eq("surfaced_by_ai", true)
      .is("session_id", null);
    if (opportunities.length) {
      await supabaseAdmin.from("opportunities").insert(
        opportunities.map((o) => ({
          company_id: companyId,
          session_id: null,
          title: o.title,
          detail: o.detail || null,
          value: o.value,
          status: "open",
          surfaced_by_ai: true,
        }))
      );
    }

    return NextResponse.json({
      ok: true,
      brief,
      playbook,
      nextSteps,
      opportunities: opportunities.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "synthesis failed" },
      { status: 500 }
    );
  }
}
