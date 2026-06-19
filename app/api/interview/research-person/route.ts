import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_THINK } from "@/lib/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { workspaceContextBlock } from "@/lib/workspace";
import { logModelUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// PER-CALL PEOPLE RESEARCH.
// Given the person you're about to meet (a name, their company, and/or a
// LinkedIn URL), this searches the OPEN WEB (not LinkedIn itself - that just
// serves a blank to a server) and writes a sharp, call-specific prep brief:
// who they really are, what they care about, the winning frame for THIS call,
// hooks into their world, smart questions to ask, the hard questions they'll
// ask back, and the right ask. The brief is written into the same "background"
// channel the prep screen already shows and the planner already folds into the
// focus, so it shapes the call's focus automatically. Saved on the call so it
// reloads without spending again.

// House style: no em/en dashes, no semicolons.
function houseStyle(s: string): string {
  return String(s || "")
    .replace(/[—–]/g, ", ")
    .replace(/;/g, ",")
    .replace(/\s+([,.])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .trimEnd();
}

// Turn a LinkedIn slug like "keith-fraser-9987b630" into a rough display name
// ("keith fraser") to seed the search when no name was given. Trailing
// id-fragments (mixes of letters and digits) are dropped.
function nameFromLinkedin(url: string): string {
  try {
    const m = String(url || "").match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (!m) return "";
    const parts = decodeURIComponent(m[1])
      .split("-")
      .filter((p) => p && !/\d/.test(p));
    return parts.join(" ").trim();
  } catch {
    return "";
  }
}

async function loadUpcoming(upcomingId: string) {
  const { data } = await supabaseAdmin
    .from("upcoming_calls")
    .select("id, company_id, title, intent, research")
    .eq("id", upcomingId)
    .maybeSingle();
  return data || null;
}

async function companyName(companyId: string | null): Promise<string> {
  if (!companyId) return "";
  const { data } = await supabaseAdmin
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle();
  return typeof data?.name === "string" ? data.name : "";
}

// GET /api/interview/research-person?upcomingId=  -> the saved brief, if any.
export async function GET(req: NextRequest) {
  try {
    const upcomingId =
      new URL(req.url).searchParams.get("upcomingId") || "";
    if (!upcomingId) return NextResponse.json({ research: null });
    const row = await loadUpcoming(upcomingId);
    return NextResponse.json({ research: (row as any)?.research ?? null });
  } catch (err: any) {
    return NextResponse.json({ research: null, error: err?.message });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const upcomingId =
      typeof body.upcomingId === "string" ? body.upcomingId.trim() : "";

    // Pull what we can from the linked call, then let the request override.
    let row: any = null;
    if (upcomingId) row = await loadUpcoming(upcomingId);

    const linkedinUrl =
      typeof body.linkedinUrl === "string" ? body.linkedinUrl.trim() : "";
    let person = typeof body.person === "string" ? body.person.trim() : "";
    if (!person && linkedinUrl) person = nameFromLinkedin(linkedinUrl);

    const companyId =
      (typeof body.companyId === "string" && body.companyId) ||
      (row && row.company_id) ||
      null;
    const company =
      (typeof body.company === "string" && body.company.trim()) ||
      (await companyName(companyId)) ||
      "";

    const role = typeof body.role === "string" ? body.role.trim() : "";
    const intent =
      (typeof body.intent === "string" && body.intent.trim()) ||
      (row && typeof row.intent === "string" ? row.intent.trim() : "") ||
      "";

    // Need at least something to identify who or what to research.
    if (!person && !company && !linkedinUrl) {
      return NextResponse.json(
        {
          error:
            "Give me a name, a company, or a LinkedIn link so I know who to research.",
        },
        { status: 400 }
      );
    }

    const idBits = [
      person ? `Name: ${person}` : "",
      role ? `Role (as known): ${role}` : "",
      company ? `Company / organisation: ${company}` : "",
      linkedinUrl ? `LinkedIn (an identity hint only, do not assume its contents): ${linkedinUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // GATE phase 1: identify the right person cheaply BEFORE spending on the
    // full brief. Returns a compact identity for the user to eyeball and
    // confirm, so a wrong-person match never costs a full brief.
    if (body.mode === "identify") {
      const idSystem = `You are verifying WHO a person is before a deeper brief is written. Use the web_search tool to find the ONE real individual that matches the details below, using the company, role and any LinkedIn hint to disambiguate a common name. Return ONLY compact JSON and nothing else: {"found": true or false, "name": "...", "headline": "their main current role", "org": "their main organisation", "location": "city and country", "confidence": "high or medium or low"}. If you cannot confidently find them, return {"found": false}. House style: never use em dashes or semicolons.`;
      const idMsg: any = await anthropic.messages.create({
        model: CLAUDE_MODEL_THINK,
        max_tokens: 400,
        temperature: 0,
        system: idSystem,
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 3 },
        ] as any,
        messages: [
          {
            role: "user",
            content: `Find this person:\n${idBits}\n\nReturn the identity JSON only.`,
          },
        ],
      });
      await logModelUsage("research-person-id", "opus", idMsg?.usage);
      const idText = (Array.isArray(idMsg?.content) ? idMsg.content : [])
        .filter((b: any) => b && b.type === "text" && typeof b.text === "string")
        .map((b: any) => b.text)
        .join("");
      let identity: any = { found: false };
      try {
        const a = idText.indexOf("{");
        const z = idText.lastIndexOf("}");
        if (a >= 0 && z > a) identity = JSON.parse(idText.slice(a, z + 1));
      } catch {
        identity = { found: false };
      }
      return NextResponse.json({ identity });
    }

    const biz = await workspaceContextBlock();

    const system = `${biz}You are a world-class call-preparation researcher and strategist working for the user described above. The user is about to have a call and wants a sharp brief on the person they will be speaking with.

Use the web_search tool to research this person across the OPEN WEB. Run several focused searches (their name with their company, their name with their role or sector, the organisations they are linked to). Do NOT rely on LinkedIn page contents, you cannot read them, search the wider web instead.

DISAMBIGUATION IS THE MOST IMPORTANT THING. Many people share a name. Use the company, role, sector and location to lock onto the RIGHT individual. If you cannot confirm you have the right person, say so plainly at the very top and only include what you are genuinely confident about. Never blend two different people into one.

ONLY use professional, public information (roles, career, public work, stated views, organisations). Do not include private, personal or sensitive information.

GROUND EVERY FACTUAL CLAIM in what the searches actually support. Do not invent roles, employers, dates or achievements. If you are unsure of something, hedge or leave it out.

Write the brief tailored to the user's GOAL FOR THIS CALL (given below). Structure it as British-English markdown with short, skimmable sections:
- Who they really are: the substance beyond a self-description, their real roles and what they are known for.
- What they care about and how they operate: values, style, what moves them.
- The winning frame for this call: how to position the user's goal so it lands with this specific person.
- Hooks into their world: concrete, specific connections between what the user does and what this person cares about.
- Smart questions to ask them: a few that make them an ally and surface where the value or the doors are.
- The hard questions they will ask back: the toughest challenges this person is likely to put to the user, and how to be ready.
- The right ask: the appropriate next step to propose given who they are, not an oversell.
- Tone: one or two lines on how to pitch it.

Be specific and practical. No flattery, no padding. Open with a one line "Who this is" identity statement so the user can sanity-check you found the right person. House style: never use em dashes or semicolons. Do not write a sources list, the system adds it.`;

    const userPrompt = `RESEARCH SUBJECT:
${idBits}

THE USER'S GOAL FOR THIS CALL:
${intent || "(not specified - infer a sensible general prep, and note that the goal was not given)"}

Research this person now and write the call-prep brief.`;

    const msg: any = await anthropic.messages.create({
      model: CLAUDE_MODEL_THINK,
      max_tokens: 2600,
      temperature: 0.3,
      system,
      // Server-side web search tool. Cast because the installed SDK types may
      // predate the web_search tool, but the API resolves it in one call.
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 5 },
      ] as any,
      messages: [{ role: "user", content: userPrompt }],
    });
    await logModelUsage("research-person", "opus", msg?.usage);

    const blocks: any[] = Array.isArray(msg?.content) ? msg.content : [];
    const text = houseStyle(
      blocks
        .filter((b) => b && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("")
        .trim()
    );

    // Collect the sources the model actually searched, from the tool results.
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
            sources.push({
              title: String(r.title || r.url),
              url: r.url,
            });
          }
        }
      }
    }
    const topSources = sources.slice(0, 8);

    if (!text) {
      return NextResponse.json(
        {
          error:
            "Couldn't pull enough on this person to brief you. Try adding their company or a LinkedIn link.",
        },
        { status: 200 }
      );
    }

    // The "background" string is what the prep screen shows and the planner
    // folds into the focus. Append the sources so they show with no extra UI.
    const background =
      text +
      (topSources.length
        ? "\n\nSources:\n" +
          topSources.map((s) => `- ${s.title}: ${s.url}`).join("\n")
        : "");

    const research = {
      person: person || null,
      company: company || null,
      linkedinUrl: linkedinUrl || null,
      intent: intent || null,
      background,
      sources: topSources,
      generatedAt: new Date().toISOString(),
    };

    if (upcomingId) {
      await supabaseAdmin
        .from("upcoming_calls")
        .update({ research })
        .eq("id", upcomingId);
    }

    return NextResponse.json({
      background,
      sources: topSources,
      person: person || null,
      company: company || null,
      research,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "research failed" },
      { status: 200 }
    );
  }
}
