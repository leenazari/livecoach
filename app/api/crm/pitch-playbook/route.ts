import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { openai, OPENAI_MODEL_PRO } from "@/lib/openai";
import { supabaseAdmin } from "@/lib/supabase";
import { logModelUsage } from "@/lib/usage";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const MODES = new Set(["prospect_demo", "commercial_partner"]);
const MANAGER_ROLES = new Set(["owner", "manager"]);
const FIELD_NOTE_MAX_CHARS = 16_000;

const clean = (value: unknown, max: number): string =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";

const externalUrl = (value: unknown): string | null => {
  const raw = clean(value, 1_500);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
};

const sourceFingerprint = (sourceUrl: string | null, source: string): string =>
  createHash("sha256")
    .update(`${sourceUrl || "no-url"}\n${source.toLowerCase().replace(/\s+/g, " ").trim()}`)
    .digest("hex");

const parseContent = (value: unknown) => {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
};

const textList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && !!item.trim())
    : [];

// Product mechanics can be useful buyer signals, but they are not reusable
// discovery questions for a seller. This guard keeps an occasional model
// classification mistake out of the saved sales script.
const internalMechanicsQuestion =
  /\b(tokens?|api\s*keys?|passwords?|log[ -]?ins?|sign[ -]?ins?|model\s+(?:name|version)|browser\s+(?:access|permission)|latency|inference\s+cost)\b/i;

const salesQuestions = (value: unknown): string[] =>
  textList(value)
    .map((item) => item.trim())
    .filter((item) => item.length <= 280 && !internalMechanicsQuestion.test(item))
    .slice(0, 6);

const boundedList = (value: unknown, limit: number, max = 360): string[] =>
  textList(value)
    .map((item) => clean(item, max))
    .filter(Boolean)
    .slice(0, limit);

const calibrationLevels = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => ({
          level: clean(item?.level, 80),
          signals: boundedList(item?.signals, 4, 220),
          sellerMove: clean(item?.sellerMove, 320),
        }))
        .filter((item) => item.level && item.signals.length && item.sellerMove)
        .slice(0, 4)
    : [];

const knowledgeChecks = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => ({
          question: clean(item?.question, 280),
          answer: clean(item?.answer, 500),
        }))
        .filter((item) => item.question && item.answer)
        .slice(0, 4)
    : [];

const objectionPairs = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => ({
          signal: clean(item?.signal, 280),
          response: clean(item?.response, 500),
        }))
        .filter((item) => item.signal && item.response)
        .slice(0, 5)
    : [];

const validMs = (value: unknown): number | null => {
  if (typeof value !== "string" || !value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const relationshipType = (company: any): string =>
  String(company?.profile?.triage?.classification || "").trim().toLowerCase();

const isInternalCompany = (company: any): boolean =>
  company?.profile?.internal === true ||
  String(company?.sector || "").trim().toLowerCase().startsWith("internal") ||
  ["in_house", "product_trial", "irrelevant", "customer"].includes(relationshipType(company)) ||
  ["in house", "product trial", "dormant", "customer"].includes(
    String(company?.stage || "").trim().toLowerCase()
  );

// The playbook is deliberately opt-in. A call only contributes after the user
// marks it as a useful prospect/demo or commercial-partner lesson.
export async function GET() {
  try {
    const scope = requireRequestScope();
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const [
      { data: lessonRows, error: lessonError },
      { data: callRows, error: callError },
      { data: companyRows, error: companyError },
      { data: sessionRows, error: sessionError },
    ] = await Promise.all([
      supabaseAdmin
        .from("lessons")
        .select("id, title, content, source_url, source_label, kind, status, visibility, owner_id, created_at, updated_at")
        .eq("workspace_id", scope.workspaceId)
        .eq("topic", "pitching")
        .neq("status", "archived")
        .or(`owner_id.eq.${scope.userId},and(visibility.eq.team,status.eq.approved)`)
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("interview_summaries")
        .select("id, session_id, candidate, role, company_id, summary, created_at")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(150),
      supabaseAdmin
        .from("companies")
        .select("id, name, sector, stage, profile")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .limit(1000),
      supabaseAdmin
        .from("interview_sessions")
        .select("session_id, started_at, ended_at")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(300),
    ]);
    const firstError = [lessonError, callError, companyError, sessionError].find(Boolean);
    if (firstError) throw firstError;

    const approvedCallIds = new Set(
      (lessonRows || [])
        .map((row: any) => String(row.source_url || "").match(/^livecoach:\/\/call\/(.+)$/)?.[1])
        .filter(Boolean)
    );
    const companyById = new Map((companyRows || []).map((company: any) => [company.id, company]));
    const sessionById = new Map((sessionRows || []).map((session: any) => [session.session_id, session]));
    const internalTitle = /\b(office|standup|internal|board|sprint|retro|one to one|1:1|all hands)\b/i;
    const commercialTitle = /\b(demo|pitch|sales|discovery|prospect|buyer|trial|pricing|proposal|customer)\b/i;

    // First pass uses only summaries and small metadata. It deliberately avoids
    // loading every historic transcript into this dashboard.
    const scored = (callRows || [])
      .filter((call: any) => !approvedCallIds.has(call.id))
      .map((call: any) => {
        const summary = call.summary && typeof call.summary === "object" ? call.summary : {};
        const company = call.company_id ? companyById.get(call.company_id) : null;
        if (isInternalCompany(company)) return null;
        const haystack = [summary.title, summary.headline, summary.overview, call.candidate, call.role]
          .filter(Boolean)
          .join(" ");
        if (internalTitle.test(haystack)) return null;

        const callType = String(summary.callType || "").trim().toLowerCase();
        if (["interview", "support"].includes(callType)) return null;
        const partner = relationshipType(company) === "partner";
        const painPoints = textList(summary.painPoints);
        const opportunities = textList(summary.commercialOpportunities);
        const nextActions = [
          ...textList(summary.myNextActions),
          ...textList(summary.suggestedNextActions),
        ];
        const concerns = textList(summary.concerns);
        const favouriteCues = Array.isArray(summary.favouriteCues)
          ? summary.favouriteCues.filter((item: any) => item && typeof item.text === "string")
          : [];
        const session = call.session_id ? sessionById.get(call.session_id) : null;
        const start = validMs(session?.started_at);
        const end = validMs(session?.ended_at);
        const durationSeconds = start != null && end != null && end > start
          ? Math.round((end - start) / 1000)
          : null;

        let score = 0;
        const reasons: string[] = [];
        if (callType === "sales") {
          score += 35;
          reasons.push("Saved as a sales call");
        }
        if (commercialTitle.test(haystack)) {
          score += 15;
          reasons.push("Demo or commercial language detected");
        }
        if (painPoints.length) {
          score += Math.min(18, 8 + painPoints.length * 3);
          reasons.push(`${painPoints.length} buyer pain ${painPoints.length === 1 ? "point" : "points"}`);
        }
        if (opportunities.length) {
          score += Math.min(16, 8 + opportunities.length * 3);
          reasons.push(`${opportunities.length} commercial ${opportunities.length === 1 ? "opportunity" : "opportunities"}`);
        }
        if (nextActions.length) score += 6;
        if (concerns.length) score += 5;
        if (favouriteCues.length) {
          score += 7;
          reasons.push("Contains questions you kept");
        }
        if (durationSeconds != null && durationSeconds >= 8 * 60) score += 8;
        if (partner && (opportunities.length || commercialTitle.test(haystack))) {
          score += 5;
          reasons.push("Commercially relevant partner");
        }

        const eligible =
          score >= 42 &&
          (callType === "sales" || commercialTitle.test(haystack) || (partner && opportunities.length > 0));
        if (!eligible || !call.session_id) return null;
        return {
          id: call.id,
          sessionId: call.session_id,
          candidate: call.candidate || null,
          role: call.role || null,
          company: company?.name || null,
          companyId: call.company_id || null,
          createdAt: call.created_at,
          callType: callType || "general",
          score: Math.min(100, score),
          reasons: reasons.slice(0, 3),
          suggestedMode: partner ? "commercial_partner" : "prospect_demo",
          durationSeconds,
          evidenceCount:
            painPoints.length + opportunities.length + nextActions.length + favouriteCues.length,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.score - a.score || String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 20);

    // Only the strongest shortlist gets a transcript-size check. The transcript
    // itself never leaves the server and is not sent to a model until approval.
    const shortlistIds = scored.map((call: any) => call.sessionId).filter(Boolean);
    const { data: transcriptRows, error: transcriptError } = shortlistIds.length
      ? await supabaseAdmin
          .from("interview_sessions")
          .select("session_id, transcript")
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .in("session_id", shortlistIds)
      : { data: [], error: null } as any;
    if (transcriptError) throw transcriptError;
    const transcriptChars = new Map(
      (transcriptRows || []).map((row: any) => [row.session_id, String(row.transcript || "").trim().length])
    );
    const reviewQueue = scored
      .map((call: any) => ({ ...call, transcriptChars: transcriptChars.get(call.sessionId) || 0 }))
      .filter((call: any) => call.transcriptChars >= 1000)
      .slice(0, 15);

    return NextResponse.json(
      {
        chapters: (lessonRows || []).map((row: any) => ({
          id: row.id,
          title: row.title,
          sourceUrl: row.source_url,
          sourceLabel: row.source_label,
          kind: row.kind || "principle",
          status: row.status || "approved",
          visibility: row.visibility || "private",
          canEdit: row.owner_id === scope.userId,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          ...parseContent(row.content),
        })),
        reviewQueue,
        canManageTeamKnowledge: MANAGER_ROLES.has(scope.role),
        reviewRules: {
          modelCost: false,
          minimumTranscriptChars: 1000,
          approvedCount: approvedCallIds.size,
        },
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not load the sales knowledge base" },
      { status: 500 }
    );
  }
}

async function createFieldNote(
  body: Record<string, unknown>,
  scope: { userId: string; workspaceId: string; role: string }
) {
  if (!MANAGER_ROLES.has(scope.role)) {
    return NextResponse.json(
      {
        error:
          "Only a workspace owner or manager can add external material to the team sales knowledge base",
      },
      { status: 403 }
    );
  }

  const source = typeof body.sourceContent === "string"
    ? body.sourceContent.trim().slice(0, FIELD_NOTE_MAX_CHARS)
    : "";
  const sourceTitle = clean(body.sourceTitle, 180);
  const sourceLabel = clean(body.sourceLabel, 200) || sourceTitle || "External sales field note";
  const suppliedUrl = clean(body.sourceUrl, 1_500);
  const sourceUrl = externalUrl(suppliedUrl);
  if (suppliedUrl && !sourceUrl) {
    return NextResponse.json(
      { error: "Use a complete http or https source link" },
      { status: 400 }
    );
  }
  if (source.length < 120) {
    return NextResponse.json(
      { error: "Paste enough source material to build a reliable training lesson" },
      { status: 422 }
    );
  }

  const fingerprint = sourceFingerprint(sourceUrl, source);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("lessons")
    .select("id")
    .eq("workspace_id", scope.workspaceId)
    .eq("source_fingerprint", fingerprint)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    return NextResponse.json(
      {
        error: "This exact source has already been turned into a sales knowledge lesson",
        existingId: existing.id,
      },
      { status: 409 }
    );
  }

  const system = `You create a practical sales-training lesson from an external field observation. The source is evidence for an idea, not proof that the idea works in every situation.

Return ONLY valid JSON in this exact shape:
{
  "title":"short practical title",
  "sourceSummary":"one concise paraphrase of what the source argues",
  "principle":"one memorable operating principle",
  "scenario":"when a salesperson should use this",
  "audience":"which buyers or conversations it applies to",
  "liveCoachSafeguard":"one limitation or false inference the salesperson must avoid",
  "calibrationLevels":[{"level":"short label","signals":["observable signal"],"sellerMove":"how to adapt"}],
  "diagnosticQuestions":["4-6 exact questions a salesperson can ask"],
  "pitchMoves":["2-5 practical adaptation moves"],
  "objections":[{"signal":"buyer phrase or behaviour","response":"warm response or check"}],
  "buyingSignals":["observable evidence relevant to this lesson"],
  "avoid":["2-5 mistakes to avoid"],
  "script":["4-8 ordered lines for a reusable conversation path"],
  "knowledgeChecks":[{"question":"short training question","answer":"clear model answer"}]
}

Rules:
- Paraphrase. Do not reproduce a passage or sentence from the source.
- Separate real-use evidence from claimed familiarity. Naming a product alone is weak evidence. Verify the workflow, direct user, result and limitation before concluding that a buyer is experienced.
- Never present politeness, nodding, brand recall or fluent terminology as a buying signal.
- Make calibrationLevels cover genuinely experienced, experimented but vague, theory-only and politely confused buyers when the source supports that distinction.
- Questions must feel curious and respectful, never like a test.
- Preserve useful uncertainty. Do not invent research, statistics, results, products or claims.
- Use plain British English. Do not use em dashes, en dashes or semicolons.
- Provide 2-4 knowledgeChecks that test application, not memorisation.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 36_000);
  let rawContent: any;
  try {
    const message = await openai.messages.create(
      {
        model: OPENAI_MODEL_PRO,
        max_tokens: 2_200,
        temperature: 0.2,
        system,
        messages: [
          {
            role: "user",
            content: `SOURCE TITLE: ${sourceTitle || "Not supplied"}\nSOURCE LABEL: ${sourceLabel}\nSOURCE LINK: ${sourceUrl || "Not supplied"}\n\nSOURCE MATERIAL:\n${source}`,
          },
        ],
      },
      { signal: controller.signal }
    );
    await logModelUsage("sales-knowledge-field-note", "pro", (message as any).usage);
    const raw = message.content
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text)
      .join("")
      .replace(/```json|```/gi, "")
      .trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    rawContent = start >= 0 && end > start
      ? JSON.parse(raw.slice(start, end + 1))
      : null;
  } finally {
    clearTimeout(timer);
  }

  const content = rawContent
    ? {
        sourceKind: "field_note",
        sourceSummary: clean(rawContent.sourceSummary, 700),
        principle: clean(rawContent.principle, 360),
        scenario: clean(rawContent.scenario, 500),
        audience: clean(rawContent.audience, 360),
        liveCoachSafeguard: clean(rawContent.liveCoachSafeguard, 600),
        calibrationLevels: calibrationLevels(rawContent.calibrationLevels),
        diagnosticQuestions: salesQuestions(rawContent.diagnosticQuestions),
        pitchMoves: boundedList(rawContent.pitchMoves, 5),
        objections: objectionPairs(rawContent.objections),
        buyingSignals: boundedList(rawContent.buyingSignals, 6),
        avoid: boundedList(rawContent.avoid, 5),
        script: boundedList(rawContent.script, 8),
        knowledgeChecks: knowledgeChecks(rawContent.knowledgeChecks),
      }
    : null;
  if (
    !content?.principle ||
    !content.scenario ||
    content.diagnosticQuestions.length < 3 ||
    content.calibrationLevels.length < 2 ||
    content.script.length < 4
  ) {
    return NextResponse.json(
      { error: "The source did not produce a reliable, usable training lesson" },
      { status: 422 }
    );
  }

  const title = clean(rawContent.title, 180) || sourceTitle || "Sales field lesson";
  const { data: lesson, error } = await supabaseAdmin
    .from("lessons")
    .insert({
      workspace_id: scope.workspaceId,
      owner_id: scope.userId,
      visibility: "private",
      topic: "pitching",
      kind: "field_note",
      status: "draft",
      title,
      content: JSON.stringify(content),
      source_url: sourceUrl,
      source_label: sourceLabel,
      source_fingerprint: fingerprint,
    })
    .select("id, title, status, visibility")
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "This exact source already exists in the workspace knowledge base" },
        { status: 409 }
      );
    }
    throw error;
  }
  return NextResponse.json({ ok: true, id: lesson.id, lesson }, { status: 201 });
}

export async function POST(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    if (body?.kind === "field_note") {
      return createFieldNote(body, scope);
    }
    const callId = typeof body.callId === "string" ? body.callId : "";
    const mode = typeof body.mode === "string" ? body.mode : "";
    if (!callId || !MODES.has(mode)) {
      return NextResponse.json(
        { error: "Choose whether this is a prospect/demo or commercial partner lesson" },
        { status: 400 }
      );
    }

    const sourceUrl = `livecoach://call/${callId}`;
    const { data: existing } = await supabaseAdmin
      .from("lessons")
      .select("id")
      .eq("workspace_id", scope.workspaceId)
      .eq("topic", "pitching")
      .eq("source_url", sourceUrl)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: "This call is already in the sales knowledge base" },
        { status: 409 }
      );
    }

    const { data: call, error: callError } = await supabaseAdmin
      .from("interview_summaries")
      .select("id, session_id, candidate, role, company_id, summary, created_at")
      .eq("id", callId)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .single();
    if (callError || !call) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }

    const [{ data: company }, { data: session }] = await Promise.all([
      call.company_id
        ? supabaseAdmin
            .from("companies")
            .select("name, profile")
            .eq("id", call.company_id)
            .eq("workspace_id", scope.workspaceId)
            .eq("owner_id", scope.userId)
            .maybeSingle()
        : Promise.resolve({ data: null } as any),
      call.session_id
        ? supabaseAdmin
            .from("interview_sessions")
            .select("transcript")
            .eq("session_id", call.session_id)
            .eq("workspace_id", scope.workspaceId)
            .eq("owner_id", scope.userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);

    if ((company as any)?.profile?.internal === true) {
      return NextResponse.json(
        { error: "Internal and in house calls cannot enter the sales knowledge base" },
        { status: 422 }
      );
    }
    const transcript = String((session as any)?.transcript || "").trim();
    if (transcript.length < 400) {
      return NextResponse.json(
        { error: "There is not enough transcript to learn a reliable pitching lesson" },
        { status: 422 }
      );
    }

    const system = `You are building a living sales training document from a REAL recorded conversation. Distil only reusable pitching intelligence supported by what was actually said and how the other party responded.

This chapter was explicitly approved as ${
      mode === "prospect_demo" ? "a prospect or demo call" : "a commercially useful partner call"
    }. Internal, operational and relationship-only material must not become sales advice.

Return ONLY valid JSON in this exact shape:
{
  "scenario":"short description of when this lesson applies",
  "audience":"who this approach is useful with",
  "buyerLanguage":["2-6 concise phrases or needs the other party actually expressed, paraphrased"],
  "questionsThatWorked":["0-6 commercially useful questions asked by the seller that produced a revealing buyer response"],
  "pitchMoves":["2-6 reusable ways to connect a need to the product"],
  "objections":[{"signal":"the concern actually raised","response":"the strongest grounded way to respond next time"}],
  "buyingSignals":["0-5 concrete signals heard in the call"],
  "avoid":["0-4 things the seller did that weakened clarity or momentum"],
  "script":["4-8 ordered, short lines another salesperson could adapt in a similar scenario"]
}

Rules:
- This is training, not a call summary. Keep only transferable mechanics and authentic buyer language.
- For questionsThatWorked, speaker ownership is mandatory. Include only questions actually asked by Lee or the seller, normally labelled Interviewer or Lee in the transcript. Never include a question asked by the buyer, prospect, partner or another participant.
- A seller question qualifies only when the buyer's answer revealed pain, process, volume, stakes, urgency, authority, commercial fit, constraints, objections or a concrete next step. Omit rhetorical questions, presentation filler and questions about internal product mechanics such as tokens, API keys, logins, model names or system configuration.
- If the transcript does not make both the speaker and the useful buyer response clear, omit the question. Do not rewrite a buyer question as though the seller asked it. An empty questionsThatWorked array is valid.
- Never invent a result, case study, objection, price, promise or product capability.
- Do not treat politeness as a buying signal.
- Keep product and scenario specificity where it makes the lesson useful.
- Use plain British English. No em dashes or en dashes.`;

    const prompt = `CALL: ${call.candidate || "Unnamed"}${
      company?.name ? ` at ${company.name}` : ""
    }
ROLE: ${call.role || "Not recorded"}
SAVED SCORECARD:
${JSON.stringify(call.summary || {}).slice(0, 7000)}

TRANSCRIPT:
${transcript.slice(-18000)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 36000);
    let content: any;
    try {
      const message = await openai.messages.create(
        {
          model: OPENAI_MODEL_PRO,
          max_tokens: 1800,
          temperature: 0.25,
          system,
          messages: [{ role: "user", content: prompt }],
        },
        { signal: controller.signal }
      );
      await logModelUsage("pitch-playbook", "pro", (message as any).usage);
      const raw = message.content
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join("")
        .replace(/```json|```/gi, "")
        .trim();
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      content = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) : null;
    } finally {
      clearTimeout(timer);
    }
    if (!content || !Array.isArray(content.script) || content.script.length === 0) {
      return NextResponse.json(
        { error: "The call did not produce a reliable training chapter" },
        { status: 422 }
      );
    }
    content.questionsThatWorked = salesQuestions(content.questionsThatWorked);

    const title = `${company?.name || call.candidate || "Sales call"}: ${content.scenario || "pitching lesson"}`.slice(0, 180);
    const { data: lesson, error } = await supabaseAdmin
      .from("lessons")
      .insert({
        workspace_id: scope.workspaceId,
        owner_id: scope.userId,
        visibility: "private",
        topic: "pitching",
        kind: "sales_call",
        status: "approved",
        title,
        content: JSON.stringify({
          ...content,
          sourceKind: "sales_call",
          mode,
          callId,
          callDate: call.created_at,
          company: company?.name || null,
          candidate: call.candidate || null,
        }),
        source_url: sourceUrl,
        source_label: "Approved LiveCoach sales call",
        source_fingerprint: createHash("sha256").update(sourceUrl).digest("hex"),
      })
      .select("id")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, id: lesson.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not add this call to the sales knowledge base" },
      { status: 500 }
    );
  }
}
