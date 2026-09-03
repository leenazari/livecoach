import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { openai, OPENAI_MODEL_PRO } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { upsertTasks } from "@/lib/tasks";
import { workspaceContextBlock } from "@/lib/workspace";
import { activeCompanyPipelineExclusion } from "@/lib/company-pipeline-exclusion";
import { createCanonicalOpenRevenueOpportunity } from "@/lib/canonical-opportunity";
import { requireRequestScope } from "@/lib/request-scope";
import { loadAssignedClientAccess } from "@/lib/assigned-client-access";
import { privateRecordFields } from "@/lib/record-scope";

export const runtime = "nodejs";
export const maxDuration = 40;

type CompletionCommitment = {
  text: string;
  ownerType: "me" | "counterparty" | "joint";
  ownerName: string;
  dueAt: string | null;
};

function validCommitmentDueAt(value: unknown, sourceCommitment: string) {
  if (typeof value !== "string" || !value.trim()) return null;
  if (!/\b(?:by|before|due|deadline|on|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|next week)\b|\b\d{1,2}[\/. -]\d{1,2}|\b20\d{2}-\d{2}-\d{2}/i.test(sourceCommitment)) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

const commitmentTokens = (value: string) =>
  new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !["the", "and", "for", "with", "from", "that", "this", "will"].includes(word))
  );

function commitmentMatch(left: string, right: string) {
  const a = commitmentTokens(left);
  const b = commitmentTokens(right);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared >= 2 && shared / Math.min(a.size, b.size) >= 0.5;
}

function fallbackCommitments(summary: any): CompletionCommitment[] {
  const mine = (Array.isArray(summary?.myNextActions) ? summary.myNextActions : [])
    .filter((value: unknown) => typeof value === "string" && value.trim())
    .slice(0, 6)
    .map((value: string) => ({
      text: value.trim(),
      ownerType: "me" as const,
      ownerName: "You",
      dueAt: null,
    }));
  const theirs = (Array.isArray(summary?.theirNextActions) ? summary.theirNextActions : [])
    .filter((value: unknown) => typeof value === "string" && value.trim())
    .slice(0, 8)
    .map((raw: string) => {
      const value = raw.trim();
      const colon = value.indexOf(":");
      return {
        text: colon > 0 && colon < 80 ? value.slice(colon + 1).trim() || value : value,
        ownerType: "counterparty" as const,
        ownerName: colon > 0 && colon < 80 ? value.slice(0, colon).trim() : "They",
        dueAt: null,
      };
    });
  return [...mine, ...theirs];
}

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
    const scope = requireRequestScope();
    const { companyId, sessionId } = await req.json();
    if (typeof companyId !== "string" || !companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    const access = await loadAssignedClientAccess(companyId, scope);
    if (!access) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }
    const companyResult =
      access.mode === "owner"
        ? await supabaseService
            .from("companies")
            .select(
              "id, name, profile, email_context_updated_at, workspace_id, owner_id, visibility"
            )
            .eq("id", companyId)
            .eq("workspace_id", scope.workspaceId)
            .eq("owner_id", scope.userId)
            .maybeSingle()
        : {
            data: {
              ...access.company,
              profile: {},
              email_context_updated_at: null,
              visibility: "team",
            },
            error: null,
          };
    const { data: savedCall, error: savedCallError } = await supabaseService
      .from("interview_summaries")
      .select("id,summary,candidate,role,company_id,created_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("session_id", sessionId)
      .maybeSingle();
    const { data: company, error: companyError } = companyResult;
    if (companyError) throw companyError;
    if (savedCallError) throw savedCallError;
    if (!company || !savedCall) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }
    if (savedCall.company_id !== companyId) {
      return NextResponse.json(
        { error: "The completed call is linked to a different client" },
        { status: 409 }
      );
    }
    const summary = savedCall.summary;
    const candidate = savedCall.candidate;
    const role = savedCall.role;
    if (!summary || typeof summary !== "object") {
      return NextResponse.json({ error: "Call summary is not ready" }, { status: 409 });
    }
    const pipelineExclusion = activeCompanyPipelineExclusion(company.profile);

    const existingBriefRaw =
      access.mode === "owner" &&
      company.profile && typeof company.profile === "object"
        ? (company.profile as any).brief
        : "";
    const existingBrief = Array.isArray(existingBriefRaw)
      ? existingBriefRaw.join("\n")
      : String(existingBriefRaw || "");
    const existingPlaybook: string[] =
      access.mode === "owner" &&
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
  "commitments": [ { "text": "one explicit commitment", "ownerType": "me|counterparty|joint", "ownerName": "the named owner, You, They or Joint", "dueAt": "ISO date-time only when an explicit deadline appears in the input, otherwise null" } ],
  "opportunities": [ { "title": "short name for a concrete CUSTOMER REVENUE opportunity for Interviewa", "detail": "one line grounding it in a buyer need or commercial commitment", "value": <rough GBP number or null> } ],
  "followUp": { "subject": "email subject", "body": "a warm, ready-to-review DRAFT follow-up email to the client referencing what was discussed and the sensible next steps" }
}

Rules:
- Ground everything ONLY in the inputs - never invent facts, names, numbers or promises.
- opportunities: 0-1. Return at most ONE active buying decision for this company-wide relationship. Combine different product use cases into its detail instead of creating separate deals. Only return a genuine customer revenue deal clearly implied by the call. Do NOT return investment, fundraising, internal product work, vendor savings, general ideas, partnerships without a buyer, or future possibilities without a current commercial conversation. Empty array if none. value is a rough number or null - never a string.
- nextCallIntent must move the existing relationship forward. Never reset to a first-meeting discovery objective unless this genuinely was the first interaction.
- commitments must be grounded in the supplied next actions. Never turn a suggestion into a promise. Never invent a deadline. Resolve an explicit relative deadline against CALL DATE and otherwise use null.
- followUp: warm and human, not pushy; reference the actual discussion and any agreed next steps; sign off generically (the host reviews and sends it themselves). It is a DRAFT, never sent automatically.`;

    const userMsg = `CLIENT: ${company.name}${candidate ? ` | spoke with: ${candidate}` : ""}${
      role ? ` | context: ${role}` : ""
    }

EXISTING PROFILE BRIEF (may be empty):
${existingBrief || "(none yet)"}

CALL DATE: ${savedCall.created_at}

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
    const sourceCommitments = fallbackCommitments(s);
    let commitments: CompletionCommitment[] = sourceCommitments;

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
        await logModelUsage(
          "update-profile",
          "pro",
          (msg as any).usage,
          { companyId, sessionId },
          scope
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
          if (Array.isArray(parsed.commitments)) {
            const proposed: CompletionCommitment[] = parsed.commitments
              .filter((item: any) => item && typeof item.text === "string" && item.text.trim())
              .slice(0, 14)
              .map((item: any) => {
                const ownerType = ["me", "counterparty", "joint"].includes(item.ownerType)
                  ? item.ownerType
                  : "counterparty";
                return {
                  text: item.text.trim().slice(0, 500),
                  ownerType,
                  ownerName: String(
                    item.ownerName ||
                      (ownerType === "me" ? "You" : ownerType === "joint" ? "Joint" : "They")
                  ).trim().slice(0, 160),
                  dueAt: typeof item.dueAt === "string" ? item.dueAt : null,
                } as CompletionCommitment;
              });
            if (proposed.length && sourceCommitments.length) {
              commitments = sourceCommitments.map((source) => {
                const match = proposed.find((item: CompletionCommitment) =>
                  commitmentMatch(source.text, item.text)
                );
                return match
                  ? {
                      ...source,
                      ownerName:
                        source.ownerType === "counterparty" && match.ownerName
                          ? match.ownerName
                          : source.ownerName,
                      dueAt: validCommitmentDueAt(match.dueAt, source.text),
                    }
                  : source;
              });
            }
          }
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
    if (access.mode === "owner") {
      const { error: profileUpdateError } = await supabaseAdmin
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
                  basedOnEmailAt:
                    (company as any).email_context_updated_at || null,
                  generatedAt: new Date().toISOString(),
                }
              : existingProfile.next_call,
            updated: new Date().toISOString(),
          },
        })
        .eq("id", companyId)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId);
      if (profileUpdateError) throw profileUpdateError;
    }

    // Idempotent per call. Follow-up drafts may be replaced, but opportunity
    // history is never deleted. The canonical helper reuses the one active
    // revenue opportunity for this company-wide relationship.
    if (sessionId) {
      await supabaseAdmin
        .from("follow_ups")
        .delete()
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq("session_id", sessionId);
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
        assignedToUserId: scope.userId,
      });
      opportunityCreated = result.created;
      opportunityConfirmation = result.clarification;
    }

    // The host's own commitments from this call become trackable tasks
    // (deduped, so re-summarising the same call never duplicates them).
    const myActions = commitments.filter(
      (commitment) => commitment.ownerType === "me" || commitment.ownerType === "joint"
    );
    await upsertTasks(
      companyId,
      myActions
        .slice(0, 6)
        .map((commitment) => ({
          text: commitment.text,
          kind: "commitment",
          linkKind: "client",
          source: "call",
          sourceRef: sessionId || null,
          dueAt: commitment.dueAt,
          payload: {
            ownerType: commitment.ownerType,
            ownerName: commitment.ownerName,
          },
        }))
    );

    // Track what the other party explicitly promised as well. These are not
    // placed in the user's ordinary to-do list; they live in Commitments so the
    // user can see what to wait for/chase and mark it received.
    const theirActions = commitments.filter(
      (commitment) => commitment.ownerType === "counterparty"
    );
    await upsertTasks(
      companyId,
      theirActions
        .slice(0, 8)
        .map((commitment) => {
          return {
            text: commitment.text,
            kind: "counterparty_commitment",
            linkKind: "client",
            source: "call",
            sourceRef: sessionId || null,
            dueAt: commitment.dueAt,
            payload: {
              ownerType: "counterparty",
              ownerName: commitment.ownerName,
            },
          };
        })
    );

    if (followUp && (followUp.subject || followUp.body)) {
      const { error: followUpError } = await supabaseAdmin.from("follow_ups").insert({
        company_id: companyId,
        session_id: sessionId || null,
        draft_subject: followUp.subject || null,
        draft_body: followUp.body || null,
        status: "draft",
        ...privateRecordFields(scope),
      });
      if (followUpError) throw followUpError;
    }

    const completionPackage = {
      relationship: { brief, playbook },
      commercial: {
        suggestion: opportunities[0] || null,
        opportunityCreated,
        clarification: opportunityConfirmation,
        pipelineExcluded: !!pipelineExclusion,
      },
      commitments,
      nextFocus: {
        intent: nextCallIntent || null,
        rationale: nextCallRationale || null,
      },
      followUp,
      generatedAt: new Date().toISOString(),
    };
    const { error: packageError } = await supabaseAdmin
      .from("interview_summaries")
      .update({ post_call_package: completionPackage })
      .eq("id", savedCall.id)
      .eq("session_id", sessionId)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId);
    if (packageError) throw packageError;

    return NextResponse.json({
      ok: true,
      opportunities: opportunityCreated ? 1 : 0,
      opportunityConfirmation,
      pipelineExcluded: !!pipelineExclusion,
      followUp: !!followUp,
      profileUpdated: access.mode === "owner",
      completionPackage,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "post-call pass failed" },
      { status: 500 }
    );
  }
}
