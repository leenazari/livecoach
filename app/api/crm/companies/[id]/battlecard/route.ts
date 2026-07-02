import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_THINK } from "@/lib/anthropic";
import { logModelUsage } from "@/lib/usage";
import { gatherClientContext } from "@/lib/crm-context";
import {
  workspaceContextBlock,
  getObjectionStancesBlock,
  getLessonsBlock,
} from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// THE BATTLECARD. A grounded, call-specific playbook like a good manual demo
// brief: a one-line read, where the product fits and where it does not, the
// spoken pitch, a timed flow, the objections that will come up with the honest
// response and a "have this ready" flag where real substance is needed, what
// not to say, questions to ask, and the next step to push for.
//
// It pulls LIVE WEB RESEARCH on the client (their public positions, relevant
// regulation) via the web_search tool, and grounds the product truth in the
// user's brain and their honest objection stances, so it never invents an audit
// or a claim they cannot stand behind. Persisted on companies.profile.battlecard
// so the call screen can load it and surface the right response as cues live.

const houseStyle = (s: string): string =>
  String(s || "")
    .replace(/[—–]/g, ", ")
    .replace(/;/g, ",")
    .replace(/\s+([,.])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const strArr = (v: any, n: number): string[] =>
  Array.isArray(v)
    ? v
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => houseStyle(x))
        .slice(0, n)
    : [];

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const companyId = params.id;
    const body = await req.json().catch(() => ({}));
    const intent =
      typeof body.intent === "string" ? body.intent.trim() : "";
    const person = typeof body.person === "string" ? body.person.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "";

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name, profile, website, domain, sector")
      .eq("id", companyId)
      .single();
    if (!company) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }

    const existing = (company.profile || {}) as any;
    const context = await gatherClientContext(companyId);

    const biz = await workspaceContextBlock();
    const stances = await getObjectionStancesBlock();
    const lessons = await getLessonsBlock([
      "negotiation",
      "strategy",
      "psychology",
    ]);

    const system = `${biz}${stances}${lessons}You are a world-class sales strategist preparing the user (described above) for a specific call with a client. Produce a grounded BATTLECARD: the plan for winning this call.

Use the web_search tool to research the CLIENT organisation on the open web where it helps: their sector and how they hire or buy, any public positions relevant to the pitch (for example a published stance on fairness or AI), and any regulation that bears on the deal (for example, for hiring tools in New York, Local Law 144). Run a few focused searches. Do not rely on pages you cannot read.

GROUNDING RULES, THESE MATTER:
- The product truth comes ONLY from the user's brain and their objection stances above. Never claim a capability, an audit, a certification or a number that is not stated there. Where a stance says CONFIRM, do not invent an answer, put the honest "have this ready, do not wing it" note in that objection's haveReady field.
- Client facts come only from the research and the CRM context below. Do not invent their positions, their volumes or their people.
- Be honest about weak fit. If the product does not suit part of their need, say so in fit.weak, do not oversell.

Write in the user's plain British-English voice, no jargon, no flattery. No markdown, no bold. No em-dashes or semicolons, use commas and full stops.

Output ONLY JSON with exactly these keys:
{
  "oneLiner": "who the client is and the angle, in one sentence",
  "fit": {
    "strong": ["where the product genuinely fits this client, 2 to 4 items"],
    "weak": ["where it does not fit, so the user narrows the pitch and does not oversell, 1 to 3 items"]
  },
  "pitch": "the spoken 60-second pitch the user can say out loud, in their voice, grounded in the client's real situation",
  "flow": [ { "minutes": "e.g. 2 or 5", "label": "what to do in this segment" } ],
  "objections": [
    {
      "objection": "the objection or hard question they will raise, in their words",
      "response": "the honest answer to give, grounded in the stances above",
      "haveReady": "where the user needs real substance not spin before the call, or null if the response fully covers it"
    }
  ],
  "doNotSay": ["things to avoid saying or doing on this call"],
  "questionsToAsk": ["sharp questions to ask them that surface the value, the doors and who else decides"],
  "nextStep": "the specific, scoped next step to push for, not an oversell"
}

Rules:
- objections: 4 to 8, ordered with the most meeting-deciding one first. Lead with fairness, risk or the biggest blocker for this client.
- flow: 4 to 6 segments that add up to a sensible meeting.
- doNotSay: 3 to 6 items. questionsToAsk: 3 to 6 items.
- Every array item is a short, plain line. haveReady is a string or null, never invent to fill it.`;

    const userPrompt = `CLIENT: ${company.name}${
      company.sector ? ` (sector: ${company.sector})` : ""
    }
${company.website || company.domain ? `Client site: ${company.website || company.domain}` : ""}
${person ? `Person on the call: ${person}${role ? `, ${role}` : ""}` : ""}

THE USER'S INTENT FOR THIS CALL:
${intent || "(not specified, infer a sensible objective from the context below)"}

EVERYTHING THE CRM KNOWS ABOUT THIS CLIENT (profile, email thread, past calls, opportunities, notes):
${context}

Research the client where it helps, then return the battlecard JSON now.`;

    let msg: any;
    try {
      msg = await anthropic.messages.create({
        model: CLAUDE_MODEL_THINK,
        max_tokens: 3200,
        system,
        // Server-side web search. Cast because installed SDK types may predate
        // the tool, but the API resolves it in one call (same as research-person).
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 5 },
        ] as any,
        messages: [{ role: "user", content: userPrompt }],
      });
    } catch (e: any) {
      console.error("battlecard model call failed:", e);
      return NextResponse.json(
        { error: "the battlecard took too long to build, try again" },
        { status: 504 }
      );
    }
    await logModelUsage("battlecard", "opus", msg?.usage);

    const blocks: any[] = Array.isArray(msg?.content) ? msg.content : [];
    const raw = blocks
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    // Collect the sources actually searched, so the brief is auditable.
    const sources: { title: string; url: string }[] = [];
    const seen = new Set<string>();
    for (const b of blocks) {
      if (b && b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) {
          if (
            r &&
            r.type === "web_search_result" &&
            typeof r.url === "string" &&
            !seen.has(r.url)
          ) {
            seen.add(r.url);
            sources.push({ title: String(r.title || r.url), url: r.url });
          }
        }
      }
    }

    let parsed: any = null;
    try {
      const a = raw.indexOf("{");
      const z = raw.lastIndexOf("}");
      if (a >= 0 && z > a) parsed = JSON.parse(raw.slice(a, z + 1));
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json(
        { error: "could not assemble the battlecard, try again" },
        { status: 502 }
      );
    }

    const objections = Array.isArray(parsed.objections)
      ? parsed.objections
          .filter((o: any) => o && typeof o.objection === "string" && o.objection.trim())
          .slice(0, 8)
          .map((o: any) => ({
            objection: houseStyle(o.objection),
            response:
              typeof o.response === "string" ? houseStyle(o.response) : "",
            haveReady:
              typeof o.haveReady === "string" && o.haveReady.trim()
                ? houseStyle(o.haveReady)
                : null,
          }))
      : [];

    const flow = Array.isArray(parsed.flow)
      ? parsed.flow
          .filter((f: any) => f && (f.label || f.minutes))
          .slice(0, 6)
          .map((f: any) => ({
            minutes:
              typeof f.minutes === "string" || typeof f.minutes === "number"
                ? String(f.minutes)
                : "",
            label: typeof f.label === "string" ? houseStyle(f.label) : "",
          }))
      : [];

    const card = {
      oneLiner:
        typeof parsed.oneLiner === "string" ? houseStyle(parsed.oneLiner) : "",
      fit: {
        strong: strArr(parsed?.fit?.strong, 4),
        weak: strArr(parsed?.fit?.weak, 3),
      },
      pitch: typeof parsed.pitch === "string" ? houseStyle(parsed.pitch) : "",
      flow,
      objections,
      doNotSay: strArr(parsed.doNotSay, 6),
      questionsToAsk: strArr(parsed.questionsToAsk, 6),
      nextStep:
        typeof parsed.nextStep === "string" ? houseStyle(parsed.nextStep) : "",
      sources: sources.slice(0, 8),
      intent: intent || null,
      generatedAt: new Date().toISOString(),
    };

    // Persist on the client so the call screen and the prep tab can reload it
    // without spending again. Preserve the rest of the profile.
    await supabaseAdmin
      .from("companies")
      .update({ profile: { ...existing, battlecard: card } })
      .eq("id", companyId);

    return NextResponse.json({ ok: true, battlecard: card });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to build the battlecard" },
      { status: 500 }
    );
  }
}

// GET /api/crm/companies/:id/battlecard -> the saved battlecard, if any.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data } = await supabaseAdmin
      .from("companies")
      .select("profile")
      .eq("id", params.id)
      .maybeSingle();
    const bc = (data?.profile as any)?.battlecard ?? null;
    return NextResponse.json({ battlecard: bc });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load the battlecard" },
      { status: 500 }
    );
  }
}
