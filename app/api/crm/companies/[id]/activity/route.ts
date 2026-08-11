import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { openai, OPENAI_MODEL_LIVE } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import {
  activityHasActions,
  cleanActivityIntelligence,
  type ActivityChannel,
} from "@/lib/activity-intelligence";
import {
  formatCommercialMemoryBlock,
  getCommercialMemory,
} from "@/lib/commercial-memory";
import { POST as approveActivity } from "@/app/api/crm/companies/[id]/activity/approve/route";
import { enqueueOpportunitySignal } from "@/lib/opportunity-signals";

export const runtime = "nodejs";
export const maxDuration = 30;

const CHANNELS = new Set<ActivityChannel>(["phone", "text", "voice", "note"]);
const CHANNEL_LABELS: Record<ActivityChannel, string> = {
  phone: "Phone call",
  text: "Text message",
  voice: "Voice note",
  note: "General note",
};

const todayInLondon = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

// Logs one off-system interaction and runs one small, grounded extraction over
// the note plus the client's concise commercial memory. The note is saved even
// if the model is unavailable. Suggested writes remain pending until the user
// approves them through /activity/approve.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let savedItem: any = null;
  try {
    const body = await req.json();
    const autoApply = body.autoApply === true;
    const channel: ActivityChannel = CHANNELS.has(body.channel)
      ? body.channel
      : "note";
    const content =
      typeof body.content === "string" ? body.content.trim().slice(0, 4000) : "";
    if (!content) {
      return NextResponse.json({ error: "update text is required" }, { status: 400 });
    }

    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("id, name, profile, commercial_memory")
      .eq("id", params.id)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) {
      return NextResponse.json({ error: "client not found" }, { status: 404 });
    }

    // Save the source first. An intelligence timeout must never lose the user's
    // phone/text/voice note.
    const { data: item, error: itemError } = await supabaseAdmin
      .from("client_context")
      .insert({
        company_id: params.id,
        kind: "note",
        title: CHANNEL_LABELS[channel],
        content,
      })
      .select()
      .single();
    if (itemError) throw itemError;
    savedItem = item;

    const memory =
      company.commercial_memory || (await getCommercialMemory(params.id));
    const memoryBlock = formatCommercialMemoryBlock(memory).slice(0, 3600);
    const system = `You extract concise commercial intelligence from one newly logged client interaction.
Output ONLY JSON with exactly this shape:
{
  "overview": "one factual sentence saying what changed",
  "buyingSignals": ["0-3 explicit signs of need, urgency, authority or willingness to progress"],
  "risks": ["0-3 explicit objections, delays, missing people or threats to progress"],
  "stakeholderUpdates": [{"person":"exact name stated","buyingRole":"decision_maker|champion|influencer|user|blocker","evidence":"short explicit evidence"}],
  "relationshipStage": "Product Trial|Partner|Customer|In House" or null,
  "nextAction": {"text":"one concrete highest-priority action","action":"email|call|task","owner":"us|buyer|joint","dueAt":"YYYY-MM-DD or null"} or null,
  "nextCallIntent": "one or two concise first-person sentences for the next conversation, or null",
  "followUp": {"subject":"short subject","body":"warm ready-to-review draft under 100 words"} or null
}

Rules:
- Ground every field only in the new update and saved memory. Never invent names, facts, dates, deal values or commitments.
- A job title alone does not prove a buying role. Add a stakeholder update only when the note explicitly identifies their role in the decision.
- When the update explicitly says the company is a tool, supplier or product being trialled, set relationshipStage to Product Trial. Do not turn that classification into a nextAction that merely asks the user to reclassify it.
- Produce one next action only. Use a due date only when the update states a real date or an unambiguous relative date. Today in London is ${todayInLondon()}.
- Draft a follow-up only when the update creates a clear reason to reply, confirm or send something. Never claim something was sent.
- Move an existing relationship forward. Do not reset the intent to generic first-call discovery.
- Use plain British English, short sentences and no markdown.`;
    const user = `CLIENT: ${company.name}
CHANNEL: ${CHANNEL_LABELS[channel]}

NEW UPDATE:
${content}

CONCISE SAVED MEMORY:
${memoryBlock || "No earlier commercial memory."}`;

    let parsed: any = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 24000);
      try {
        const message = await openai.messages.create(
          {
            model: OPENAI_MODEL_LIVE,
            max_tokens: 750,
            temperature: 0.2,
            system,
            messages: [{ role: "user", content: user }],
          },
          { signal: controller.signal }
        );
        await logModelUsage("activity-intelligence", "live", (message as any).usage);
        const raw = message.content
          .filter((part: any) => part.type === "text")
          .map((part: any) => part.text)
          .join("")
          .replace(/```json|```/g, "")
          .trim();
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        parsed = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) : null;
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      console.error("Activity intelligence failed:", error);
    }

    if (!parsed) {
      await getCommercialMemory(params.id);
      return NextResponse.json({
        item,
        intelligence: null,
        warning:
          "The update is safely logged, but its commercial suggestions could not be built this time.",
      });
    }

    const intelligence = cleanActivityIntelligence(parsed, {
      contextId: item.id,
      createdAt: item.created_at,
      channel,
    });
    if (!intelligence.overview) intelligence.overview = content.slice(0, 320);
    if (!activityHasActions(intelligence)) {
      intelligence.status = "applied";
      intelligence.appliedAt = new Date().toISOString();
      intelligence.applied = [];
    }

    const profile =
      company.profile && typeof company.profile === "object" ? company.profile : {};
    const existingActivity =
      (profile as any).activity_intelligence &&
      typeof (profile as any).activity_intelligence === "object"
        ? (profile as any).activity_intelligence
        : {};
    const history = Array.isArray(existingActivity.history)
      ? existingActivity.history
      : [];
    const historyItem = {
      contextId: intelligence.contextId,
      createdAt: intelligence.createdAt,
      channel: intelligence.channel,
      overview: intelligence.overview,
      buyingSignals: intelligence.buyingSignals,
      risks: intelligence.risks,
    };
    const { error: profileError } = await supabaseAdmin
      .from("companies")
      .update({
        profile: {
          ...profile,
          activity_intelligence: {
            ...existingActivity,
            latest: intelligence,
            history: [
              historyItem,
              ...history.filter(
                (entry: any) => entry?.contextId !== intelligence.contextId
              ),
            ].slice(0, 12),
          },
          updated: new Date().toISOString(),
        },
      })
      .eq("id", params.id);
    if (profileError) throw profileError;

    const signalChannel = channel === "phone" ? "phone" : "other";
    await enqueueOpportunitySignal({
      companyId: params.id,
      sourceRecordType: "manual_activity",
      sourceRecordId: item.id,
      sourceChannel: signalChannel,
      occurredAt: item.created_at,
      evidence: {
        overview: intelligence.overview,
        buyingSignals: intelligence.buyingSignals,
        risks: intelligence.risks,
        nextAction: intelligence.nextAction?.text,
        nextCallIntent: intelligence.nextCallIntent,
        relationshipStage: intelligence.relationshipStage,
      },
    }).catch((error) => console.error("Activity outlook signal queue failed:", error));

    // A Brain action has already been explicitly approved in its action tray.
    // Apply the small, server-saved plan in the same request so one spoken
    // update can refresh the timeline, memory, next move and next-call intent
    // without asking the user to approve the same update a second time.
    if (autoApply && activityHasActions(intelligence)) {
      const approveRequest = new NextRequest(
        new URL(`/api/crm/companies/${params.id}/activity/approve`, req.url),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contextId: item.id }),
        }
      );
      const approvalResponse = await approveActivity(approveRequest, { params });
      const approval = await approvalResponse.json();
      if (!approvalResponse.ok) {
        throw new Error(approval?.error || "The logged update could not be applied");
      }
      return NextResponse.json({
        item,
        intelligence: approval.intelligence,
        applied: approval.applied || [],
        warnings: approval.warnings || [],
      });
    }

    // Persist a refreshed facts-only memory so every Brain entry point sees the
    // new signal without loading the raw transcript again.
    await getCommercialMemory(params.id);

    return NextResponse.json({ item, intelligence });
  } catch (error: any) {
    // Once the source note exists, respond as a successful log even if a later
    // intelligence step fails. Otherwise retrying would create duplicate notes.
    if (savedItem) {
      console.error("Activity was logged but intelligence was not saved:", error);
      await getCommercialMemory(params.id);
      return NextResponse.json({
        item: savedItem,
        intelligence: null,
        warning:
          "The update is safely logged, but its commercial suggestions could not be saved this time.",
      });
    }
    return NextResponse.json(
      { error: error?.message || "failed to log client activity" },
      { status: 500 }
    );
  }
}
