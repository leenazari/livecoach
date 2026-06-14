import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";
import { upsertTasks } from "@/lib/tasks";

export const runtime = "nodejs";
export const maxDuration = 40;

// PHASE 3 - the post-call CRM pass. After a LINKED call is summarised, ONE
// Sonnet pass turns the scorecard + the client's existing profile into three
// things, which we then store against the company:
//   1. an updated running "what we know" profile brief,
//   2. any concrete OPPORTUNITIES the call surfaced,
//   3. a ready-to-review DRAFT follow-up email (never auto-sent).
// Fire-and-forget from the client; never blocks the call. Idempotent per
// session: re-running replaces this call's opportunities + follow-up draft.
export async function POST(req: NextRequest) {
  try {
    const { companyId, summary, sessionId, candidate, role } = await req.json();
    if (typeof companyId !== "string" || !companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }
    if (!summary || typeof summary !== "object") {
      return NextResponse.json({ error: "summary is required" }, { status: 400 });
    }

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name, profile")
      .eq("id", companyId)
      .single();
    if (!company) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }

    const existingBriefRaw =
      company.profile && typeof company.profile === "object"
        ? (company.profile as any).brief
        : "";
    const existingBrief = Array.isArray(existingBriefRaw)
      ? existingBriefRaw.join("\n")
      : String(existingBriefRaw || "");
    const existingPlaybook: string[] =
      company.profile &&
      typeof company.profile === "object" &&
      Array.isArray((company.profile as any).playbook)
        ? (company.profile as any).playbook
        : [];

    const s = summary as any;
    const callText = [
      s.headline ? `Headline: ${s.headline}` : "",
      s.overview ? `How it went: ${s.overview}` : "",
      Array.isArray(s.myNextActions) && s.myNextActions.length
        ? `We still owe: ${s.myNextActions.join("; ")}`
        : "",
      Array.isArray(s.theirNextActions) && s.theirNextActions.length
        ? `They said they'd: ${s.theirNextActions.join("; ")}`
        : "",
      Array.isArray(s.suggestedNextActions) && s.suggestedNextActions.length
        ? `Smart next moves: ${s.suggestedNextActions.join("; ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const system = `After a call with a client, you produce three things from the call and the client's existing profile. Output ONLY JSON with exactly these keys:

{
  "brief": [ "the UPDATED running profile as a SCANNABLE BULLET LIST - one short bullet per distinct subject, person or thread (who they are, what they want, key people, decisions, open threads on either side, preferences). Lead with the subject or name where it helps. Never a paragraph. Merge with the existing brief: keep what's true, update what changed, add what's new, drop one-off noise. 3-8 bullets, no call-by-call log." ],
  "playbook": [ "3-6 short, punchy strategic plays - the MAIN moves to advance THIS specific client toward the outcome the host wants (win the deal, land the project, get the yes). Ordered most important first. Each is ONE short sentence, practical and specific to this client and the open threads - not generic sales advice. This is the host's game plan for the relationship." ],
  "opportunities": [ { "title": "short name for a concrete opportunity FOR US this call surfaced (a deal, upsell, a need we can serve, a next project)", "detail": "one line grounding it in what was said", "value": <rough GBP number or null> } ],
  "followUp": { "subject": "email subject", "body": "a warm, ready-to-review DRAFT follow-up email to the client referencing what was discussed and the sensible next steps" }
}

Rules:
- Ground everything ONLY in the inputs - never invent facts, names, numbers or promises.
- opportunities: 0-4, ONLY real ones clearly implied by the call. Empty array if none. value is a rough number or null - never a string.
- followUp: warm and human, not pushy; reference the actual discussion and any agreed next steps; sign off generically (the host reviews and sends it themselves). It is a DRAFT, never sent automatically.`;

    const userMsg = `CLIENT: ${company.name}${candidate ? ` | spoke with: ${candidate}` : ""}${
      role ? ` | context: ${role}` : ""
    }

EXISTING PROFILE BRIEF (may be empty):
${existingBrief || "(none yet)"}

THIS CALL:
${callText || "(little of note)"}

Return the JSON now.`;

    let brief: string[] = Array.isArray(existingBriefRaw)
      ? existingBriefRaw
      : existingBrief
      ? [existingBrief]
      : [];
    let playbook: string[] = existingPlaybook;
    let opportunities: { title: string; detail: string; value: number | null }[] = [];
    let followUp: { subject: string; body: string } | null = null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 32000);
      try {
        const msg = await anthropic.messages.create(
          {
            model: CLAUDE_MODEL_PRO,
            max_tokens: 1100,
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
          if (
            parsed.followUp &&
            typeof parsed.followUp === "object" &&
            (parsed.followUp.subject || parsed.followUp.body)
          ) {
            followUp = {
              subject: String(parsed.followUp.subject || "").trim(),
              body: String(parsed.followUp.body || "").trim(),
            };
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      console.error("Post-call CRM pass failed:", e);
    }

    // Store profile.
    await supabaseAdmin
      .from("companies")
      .update({
        profile: { brief, playbook, updated: new Date().toISOString() },
      })
      .eq("id", companyId);

    // Idempotent per call: clear this session's prior AI rows, then re-insert.
    if (sessionId) {
      await supabaseAdmin
        .from("opportunities")
        .delete()
        .eq("session_id", sessionId)
        .eq("surfaced_by_ai", true);
      await supabaseAdmin.from("follow_ups").delete().eq("session_id", sessionId);
    }

    if (opportunities.length) {
      await supabaseAdmin.from("opportunities").insert(
        opportunities.map((o) => ({
          company_id: companyId,
          session_id: sessionId || null,
          title: o.title,
          detail: o.detail || null,
          value: o.value,
          status: "open",
          surfaced_by_ai: true,
        }))
      );
    }

    // The host's own commitments from this call become trackable tasks
    // (deduped, so re-summarising the same call never duplicates them).
    const myActions = Array.isArray(s.myNextActions) ? s.myNextActions : [];
    await upsertTasks(
      companyId,
      myActions
        .filter((a: any) => typeof a === "string" && a.trim())
        .slice(0, 6)
        .map((a: string) => ({
          text: a,
          kind: "commitment",
          linkKind: "client",
          source: "call",
          sourceRef: sessionId || null,
        }))
    );

    if (followUp && (followUp.subject || followUp.body)) {
      await supabaseAdmin.from("follow_ups").insert({
        company_id: companyId,
        session_id: sessionId || null,
        draft_subject: followUp.subject || null,
        draft_body: followUp.body || null,
        status: "draft",
      });
    }

    return NextResponse.json({
      ok: true,
      opportunities: opportunities.length,
      followUp: !!followUp,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "post-call pass failed" },
      { status: 500 }
    );
  }
}
