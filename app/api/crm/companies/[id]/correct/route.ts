import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";
import { logModelUsage } from "@/lib/usage";
import { upsertTasks } from "@/lib/tasks";
import { workspaceContextBlock } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 40;
// POST route with a body, so it is inherently dynamic, but be explicit (see the
// 405 INVALID_REQUEST_METHOD lesson on statically-optimised routes).
export const dynamic = "force-dynamic";

// CORRECTION WRITE-BACK. When the user corrects a fact in the brain chat
// ("Joydeep wasn't the one who was sick, it was his colleague"), the chat used
// to just acknowledge it while the STORED records stayed stale. This endpoint
// makes the correction stick: it saves the correction as an authoritative note
// on the client, then in ONE grounded Sonnet pass rewrites the live views (the
// "what we know" brief, the playbook, the next-step tasks) AND the call-history
// summaries so nothing visibly contradicts the correction. Conservative: it
// only changes statements that actually conflict with the correction and never
// invents anything.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const companyId = params.id;
    const { correction } = await req.json();
    const fix = typeof correction === "string" ? correction.trim() : "";
    if (fix.length < 4) {
      return NextResponse.json({ error: "correction is required" }, { status: 400 });
    }

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name, profile")
      .eq("id", companyId)
      .single();
    if (!company) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }

    // 1) Save the correction as an authoritative note so EVERY future AI pass
    //    (plans, cues, chat, synthesis) honours it over older notes and calls.
    await supabaseAdmin.from("client_context").insert({
      company_id: companyId,
      kind: "note",
      title: "Correction",
      content: `CORRECTION (authoritative, overrides any earlier note or call summary that conflicts): ${fix}`,
    });

    // Gather what the correction might touch: the current brief + playbook, the
    // OPEN tasks (with ids, so we can dismiss ones the correction contradicts),
    // and recent call summaries' text fields (with ids, so we can rewrite them).
    const existing = (company.profile || {}) as any;
    const existingBrief = Array.isArray(existing.brief)
      ? existing.brief
      : existing.brief
      ? [String(existing.brief)]
      : [];
    const existingPlaybook = Array.isArray(existing.playbook)
      ? existing.playbook
      : [];

    const [tasksRes, summariesRes] = await Promise.all([
      supabaseAdmin
        .from("tasks")
        .select("id, text, kind")
        .eq("company_id", companyId)
        .eq("status", "open")
        .limit(50),
      supabaseAdmin
        .from("interview_summaries")
        .select("id, summary, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    const openTasks = (tasksRes.data || []).map((t: any) => ({
      id: String(t.id),
      text: String(t.text || ""),
    }));
    const summaries = (summariesRes.data || []).map((s: any) => {
      const sm = (s.summary || {}) as any;
      return {
        id: String(s.id),
        headline: typeof sm.headline === "string" ? sm.headline : "",
        overview: typeof sm.overview === "string" ? sm.overview : "",
        recommendation:
          typeof sm.recommendation === "string" ? sm.recommendation : "",
      };
    });

    const biz = await workspaceContextBlock();
    const system = `${biz}The user has CORRECTED a fact about a client. Apply that correction to their stored records so nothing contradicts it. You are given the correction, the current "what we know" brief, the playbook, the open to-dos (with ids), and recent call summaries (with ids). Output ONLY JSON with exactly these keys:

{
  "brief": [ "the corrected 'what we know' bullets, one short line each, 3-8 bullets. Keep everything that is still true, fix only what the correction changes." ],
  "playbook": [ "the corrected ordered plays, 3-6 short lines. Fix only what the correction changes, keep the rest." ],
  "dismissTaskIds": [ "ids of OPEN to-dos that are now WRONG because of the correction (only ones that genuinely contradict it). Leave the rest." ],
  "addNextSteps": [ { "text": "a corrected replacement to-do if a dismissed one still needs doing in corrected form", "action": "email | call | task" } ],
  "summaries": [ { "id": "<summary id>", "headline": "corrected headline", "overview": "corrected overview", "recommendation": "corrected recommendation" } ]
}

Rules:
- The correction is AUTHORITATIVE. Where the existing text conflicts with it, rewrite to match the correction. Where it does not conflict, leave the text EXACTLY as it was.
- Ground everything only in what you are given plus the correction. NEVER invent new facts, names, numbers, dates or commitments.
- Only include a summary in "summaries" if at least one of its fields actually needed changing. Omit unchanged summaries entirely.
- Only list a task id in "dismissTaskIds" if it genuinely contradicts the correction. If a dismissed task still needs doing in a corrected form, add the corrected version to "addNextSteps" (action exactly one of email, call, task). If nothing needs adding, return an empty array.
- Plain English only. No markdown, no "#" headings, no "**bold**". No em-dashes or semicolons, use commas and full stops.`;

    const userMsg = `CLIENT: ${company.name}

THE CORRECTION (authoritative):
${fix}

CURRENT "WHAT WE KNOW" BRIEF:
${existingBrief.length ? existingBrief.map((b: string) => `- ${b}`).join("\n") : "(none)"}

CURRENT PLAYBOOK:
${existingPlaybook.length ? existingPlaybook.map((p: string) => `- ${p}`).join("\n") : "(none)"}

OPEN TO-DOS (id :: text):
${openTasks.length ? openTasks.map((t) => `${t.id} :: ${t.text}`).join("\n") : "(none)"}

RECENT CALL SUMMARIES (id, then fields):
${
      summaries.length
        ? summaries
            .map(
              (s) =>
                `id: ${s.id}\nheadline: ${s.headline}\noverview: ${s.overview}\nrecommendation: ${s.recommendation}`
            )
            .join("\n---\n")
        : "(none)"
    }

Return the JSON now.`;

    let brief: string[] = existingBrief;
    let playbook: string[] = existingPlaybook;
    let dismissTaskIds: string[] = [];
    let addNextSteps: { text: string; action: string }[] = [];
    let summaryFixes: {
      id: string;
      headline?: string;
      overview?: string;
      recommendation?: string;
    }[] = [];

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 34000);
      try {
        const msg = await anthropic.messages.create(
          {
            model: CLAUDE_MODEL_PRO,
            max_tokens: 1600,
            temperature: 0.2,
            system,
            messages: [{ role: "user", content: userMsg }],
          },
          { signal: controller.signal }
        );
        await logModelUsage("correct", "sonnet", (msg as any).usage);
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
          }
          if (Array.isArray(parsed.playbook)) {
            const pb = parsed.playbook
              .filter((p: any) => typeof p === "string" && p.trim())
              .map((p: string) => p.trim())
              .slice(0, 6);
            if (pb.length) playbook = pb;
          }
          if (Array.isArray(parsed.dismissTaskIds)) {
            const validIds = new Set(openTasks.map((t) => t.id));
            dismissTaskIds = parsed.dismissTaskIds
              .map((x: any) => String(x))
              .filter((x: string) => validIds.has(x));
          }
          if (Array.isArray(parsed.addNextSteps)) {
            addNextSteps = parsed.addNextSteps
              .map((s: any) => {
                if (s && typeof s.text === "string" && s.text.trim()) {
                  const act = ["email", "call", "task"].includes(s.action)
                    ? s.action
                    : "task";
                  return { text: String(s.text).trim(), action: act };
                }
                return null;
              })
              .filter((x: any): x is { text: string; action: string } => !!x)
              .slice(0, 6);
          }
          if (Array.isArray(parsed.summaries)) {
            const validIds = new Set(summaries.map((s) => s.id));
            summaryFixes = parsed.summaries
              .filter(
                (s: any) => s && typeof s.id === "string" && validIds.has(s.id)
              )
              .slice(0, 5);
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      console.error("Correction pass failed:", e);
      // The authoritative note is already saved, so future passes still honour
      // the correction even if this regeneration timed out.
      return NextResponse.json(
        {
          error:
            "saved the correction, but rewriting the records took too long, try again",
        },
        { status: 504 }
      );
    }

    // Apply the corrected brief + playbook.
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

    // Rewrite the call summaries that conflicted, preserving every other field.
    for (const fixSum of summaryFixes) {
      const row = (summariesRes.data || []).find(
        (s: any) => String(s.id) === fixSum.id
      );
      if (!row) continue;
      const merged = { ...(row.summary || {}) } as any;
      if (typeof fixSum.headline === "string") merged.headline = fixSum.headline;
      if (typeof fixSum.overview === "string") merged.overview = fixSum.overview;
      if (typeof fixSum.recommendation === "string")
        merged.recommendation = fixSum.recommendation;
      await supabaseAdmin
        .from("interview_summaries")
        .update({ summary: merged })
        .eq("id", fixSum.id);
    }

    // Dismiss the open to-dos the correction made wrong.
    if (dismissTaskIds.length) {
      await supabaseAdmin
        .from("tasks")
        .update({ status: "dismissed" })
        .eq("company_id", companyId)
        .in("id", dismissTaskIds);
    }

    // Add corrected replacement to-dos (deduped by fingerprint).
    if (addNextSteps.length) {
      await upsertTasks(
        companyId,
        addNextSteps.map((s) => ({
          text: s.text,
          kind: "next_step",
          linkKind: s.action,
          source: "correction",
        }))
      );
    }

    return NextResponse.json({
      ok: true,
      brief,
      playbook,
      summariesFixed: summaryFixes.length,
      tasksDismissed: dismissTaskIds.length,
      tasksAdded: addNextSteps.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "correction failed" },
      { status: 500 }
    );
  }
}
