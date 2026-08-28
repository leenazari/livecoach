import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { openai, OPENAI_MODEL_PRO } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { upsertTasks } from "@/lib/tasks";
import { workspaceContextBlock } from "@/lib/workspace";
import { activeCompanyPipelineExclusion } from "@/lib/company-pipeline-exclusion";
import { createCanonicalOpenRevenueOpportunity } from "@/lib/canonical-opportunity";

export const runtime = "nodejs";
export const maxDuration = 40;

// PHASE 3 - the post-call CRM pass. After a LINKED call is summarised, ONE
// Terra pass turns the scorecard + the client's existing profile into three
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
      .select("id, name, profile, email_context_updated_at, workspace_id, owner_id, visibility")
      .eq("id", companyId)
      .single();
    if (!company) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }
    const pipelineExclusion = activeCompanyPipelineExclusion(company.profile);

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

    const biz = await workspaceContextBlock();
    const system = `${biz}After a call with a client, you produce the durable relationship memory and the starting intent for the next call. Output ONLY JSON with exactly these keys:

{
  "brief": [ "the UPDATED running profile as a SCANNABLE BULLET LIST - one short bullet per distinct subject, person or thread (who they are, what they want, key people, decisions, open threads on either side, preferences). Lead with the subject or name where it helps. Never a paragraph. Merge with the existing brief: keep what's true, update what changed, add what's new, drop one-off noise. 3-8 bullets, no call-by-call log." ],
  "playbook": [ "3-6 short, punchy strategic plays - the MAIN moves to advance THIS specific client toward the outcome the host wants (win the deal, land the project, get the yes). Ordered most important first. Each is ONE short sentence, practical and specific to this client and the open threads - not generic sales advice. This is the host's game plan for the relationship." ],
  "nextCallIntent": "1-2 concise first-person sentences for the NEXT conversation, based on this call's outcome, unresolved commitments and the most valuable next step",
  "nextCallRationale": "one short sentence explaining which unresolved thread or action makes that the priority",
  "opportunities": [ { "title": "short name for a concrete CUSTOMER REVENUE opportunity for Interviewa", "detail": "one line grounding it in a buyer need or commercial commitment", "value": <rough GBP number or null> } ],
  "followUp": { "subject": "email subject", "body": "a warm, ready-to-review DRAFT follow-up email to the client referencing what was discussed and the sensible next steps" }
}

Rules:
- Ground everything ONLY in the inputs - never invent facts, names, numbers or promises.
- opportunities: 0-1. Return at most ONE active buying decision for this company-wide relationship. Combine different product use cases into its detail instead of creating separate deals. Only return a genuine customer revenue deal clearly implied by the call. Do NOT return investment, fundraising, internal product work, vendor savings, general ideas, partnerships without a buyer, or future possibilities without a current commercial conversation. Empty array if none. value is a rough number or null - never a string.
- nextCallIntent must move the existing relationship forward. Never reset to a first-meeting discovery objective unless this genuinely was the first interaction.
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
    let nextCallIntent = "";
    let nextCallRationale = "";

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 32000);
      try {
        const msg = await openai.messages.create(
          {
            model: OPENAI_MODEL_PRO,
            max_tokens: 1100,
            temperature: 0.3,
            system,
            messages: [{ role: "user", content: userMsg }],
          },
          { signal: controller.signal }
        );
        await logModelUsage("update-profile", "pro", (msg as any).usage);
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
              .slice(0, 1)
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
          if (typeof parsed.nextCallIntent === "string")
            nextCallIntent = parsed.nextCallIntent.trim();
          if (typeof parsed.nextCallRationale === "string")
            nextCallRationale = parsed.nextCallRationale.trim();
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      console.error("Post-call CRM pass failed:", e);
    }

    // Store profile.
    //
    // MERGE, NEVER REPLACE. This used to write { brief, playbook, updated } on
    // its own, which silently destroyed every other key on the profile after a
    // call: the battlecard, the `internal` flag that tells the planner this is
    // your own team, and the cached company research the prep chain pays for.
    // Spread the existing profile so only the two keys this pass owns change.
    const existingProfile =
      company.profile && typeof company.profile === "object"
        ? (company.profile as any)
        : {};
    await supabaseAdmin
      .from("companies")
      .update({
        profile: {
          ...existingProfile,
          brief,
          playbook,
          next_call: nextCallIntent
            ? {
                intent: nextCallIntent,
                rationale: nextCallRationale,
                basedOnSessionId: sessionId || null,
                basedOnEmailAt: (company as any).email_context_updated_at || null,
                generatedAt: new Date().toISOString(),
              }
            : existingProfile.next_call,
          updated: new Date().toISOString(),
        },
      })
      .eq("id", companyId);

    // Idempotent per call. Follow-up drafts may be replaced, but opportunity
    // history is never deleted. The canonical helper reuses the one active
    // revenue opportunity for this company-wide relationship.
    if (sessionId) {
      await supabaseAdmin.from("follow_ups").delete().eq("session_id", sessionId);
    }

    let opportunityCreated = false;
    let opportunityConfirmation = null;
    if (opportunities.length && !pipelineExclusion) {
      const suggestion = opportunities[0];
      const result = await createCanonicalOpenRevenueOpportunity(company as any, {
        title: suggestion.title,
        detail: suggestion.detail || null,
        value: suggestion.value,
        sessionId: sessionId || null,
        source: "call",
        surfacedByAi: true,
      });
      opportunityCreated = result.created;
      opportunityConfirmation = result.clarification;
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
          payload: { ownerType: "me", ownerName: "You" },
        }))
    );

    // Track what the other party explicitly promised as well. These are not
    // placed in the user's ordinary to-do list; they live in Commitments so the
    // user can see what to wait for/chase and mark it received.
    const theirActions = Array.isArray(s.theirNextActions)
      ? s.theirNextActions
      : [];
    await upsertTasks(
      companyId,
      theirActions
        .filter((a: any) => typeof a === "string" && a.trim())
        .slice(0, 8)
        .map((raw: string) => {
          const value = raw.trim();
          const colon = value.indexOf(":");
          const ownerName =
            colon > 0 && colon < 80 ? value.slice(0, colon).trim() : "They";
          const action =
            colon > 0 && colon < 80 ? value.slice(colon + 1).trim() : value;
          return {
            text: action || value,
            kind: "counterparty_commitment",
            linkKind: "client",
            source: "call",
            sourceRef: sessionId || null,
            payload: { ownerType: "counterparty", ownerName },
          };
        })
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
      opportunities: opportunityCreated ? 1 : 0,
      opportunityConfirmation,
      pipelineExcluded: !!pipelineExclusion,
      followUp: !!followUp,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "post-call pass failed" },
      { status: 500 }
    );
  }
}
