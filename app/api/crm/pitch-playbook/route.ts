import { NextRequest, NextResponse } from "next/server";
import { openai, OPENAI_MODEL_PRO } from "@/lib/openai";
import { supabaseAdmin } from "@/lib/supabase";
import { logModelUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const MODES = new Set(["prospect_demo", "commercial_partner"]);

const parseContent = (value: unknown) => {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
};

// The playbook is deliberately opt-in. A call only contributes after the user
// marks it as a useful prospect/demo or commercial-partner lesson.
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("lessons")
      .select("id, title, content, source_url, created_at")
      .eq("topic", "pitching")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json(
      {
        chapters: (data || []).map((row: any) => ({
          id: row.id,
          title: row.title,
          sourceUrl: row.source_url,
          createdAt: row.created_at,
          ...parseContent(row.content),
        })),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not load the pitching playbook" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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
      .eq("topic", "pitching")
      .eq("source_url", sourceUrl)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: "This call is already in the pitching playbook" },
        { status: 409 }
      );
    }

    const { data: call, error: callError } = await supabaseAdmin
      .from("interview_summaries")
      .select("id, session_id, candidate, role, company_id, summary, created_at")
      .eq("id", callId)
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
            .maybeSingle()
        : Promise.resolve({ data: null } as any),
      call.session_id
        ? supabaseAdmin
            .from("interview_sessions")
            .select("transcript")
            .eq("session_id", call.session_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);

    if ((company as any)?.profile?.internal === true) {
      return NextResponse.json(
        { error: "Internal and in house calls cannot enter the pitching playbook" },
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
  "questionsThatWorked":["2-6 questions or question patterns that opened useful information"],
  "pitchMoves":["2-6 reusable ways to connect a need to the product"],
  "objections":[{"signal":"the concern actually raised","response":"the strongest grounded way to respond next time"}],
  "buyingSignals":["0-5 concrete signals heard in the call"],
  "avoid":["0-4 things the seller did that weakened clarity or momentum"],
  "script":["4-8 ordered, short lines another salesperson could adapt in a similar scenario"]
}

Rules:
- This is training, not a call summary. Keep only transferable mechanics and authentic buyer language.
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

    const title = `${company?.name || call.candidate || "Sales call"}: ${content.scenario || "pitching lesson"}`.slice(0, 180);
    const { data: lesson, error } = await supabaseAdmin
      .from("lessons")
      .insert({
        topic: "pitching",
        title,
        content: JSON.stringify({
          ...content,
          mode,
          callId,
          callDate: call.created_at,
          company: company?.name || null,
          candidate: call.candidate || null,
        }),
        source_url: sourceUrl,
      })
      .select("id")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, id: lesson.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not add this call to the pitching playbook" },
      { status: 500 }
    );
  }
}
