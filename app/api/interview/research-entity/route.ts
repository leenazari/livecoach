import { NextRequest, NextResponse } from "next/server";
import {
  openai,
  OPENAI_MODEL_PRO,
  OPENAI_MODEL_THINK,
} from "@/lib/openai";
import { supabaseAdmin } from "@/lib/supabase";
import { workspaceContextBlock } from "@/lib/workspace";
import { logModelUsage } from "@/lib/usage";
import {
  COMPANY_TTL_DAYS,
  PERSON_TTL_DAYS,
  EntityResearch,
  collectSources,
  companyState,
  houseStyle,
  loadCompany,
  mirrorOntoUpcoming,
  nameFromLinkedin,
  personState,
  resolveContact,
  saveCompanyResearch,
  savePersonResearch,
  textOf,
} from "@/lib/research-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// RESEARCH ENTITY - the cached, once-per-entity researcher behind the prep chain.
//
// Two modes, and every call checks the cache FIRST so nothing is ever researched
// twice inside its freshness window:
//
//   mode "company"                -> companies.profile.research   (90 day TTL)
//   mode "person", stage identify -> who is this, cheaply, before spending
//   mode "person", stage brief    -> contacts.attributes.research (180 day TTL)
//
// The person pass is split across two HTTP calls on purpose. Identify plus brief
// in one serverless invocation runs close to the 60 second platform cap, and a
// timeout there would waste the identify spend. Split, each stage has room.
//
// The identify stage also decides the gate:
//   confidence high            -> { decision: "auto" }    the chain briefs straight away
//   confidence medium or low   -> { decision: "confirm" } the chain stops and asks
//   not found                  -> { decision: "none" }    the chain carries on without it
//
// Every successful brief is mirrored onto upcoming_calls.research, whose
// `background` string is exactly what the live call screen already reloads and
// the planner already folds into the focus. Nothing on the call screen changes.

type Body = {
  mode?: "company" | "person";
  stage?: "identify" | "brief";
  upcomingId?: string;
  companyId?: string;
  contactId?: string;
  company?: string;
  website?: string;
  person?: string;
  personEmail?: string;
  role?: string;
  linkedinUrl?: string;
  intent?: string;
  force?: boolean;
  identity?: any;
};

const str = (v: any): string => (typeof v === "string" ? v.trim() : "");

function parseJsonish(raw: string): any {
  try {
    const a = raw.indexOf("{");
    const z = raw.lastIndexOf("}");
    if (a >= 0 && z > a) return JSON.parse(raw.slice(a, z + 1));
  } catch {
    /* fall through */
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body: Body = await req.json().catch(() => ({} as Body));
    const mode = body.mode === "person" ? "person" : "company";
    const upcomingId = str(body.upcomingId);
    const force = body.force === true;
    const intent = str(body.intent);

    // =======================================================================
    // COMPANY
    // =======================================================================
    if (mode === "company") {
      const companyId = str(body.companyId);
      const record = await loadCompany(companyId || null);
      const name = str(body.company) || (record && record.name) || "";
      const website =
        str(body.website) ||
        (record && str(record.website)) ||
        "";

      if (!name && !website) {
        return NextResponse.json({
          skipped: true,
          reason: "no company to research yet",
        });
      }

      // Cache first. A fresh brief is returned without spending anything.
      if (record && !force) {
        const cached = companyState(record);
        if (cached.have && cached.fresh) {
          if (upcomingId) {
            await mirrorOntoUpcoming(
              upcomingId,
              (record.profile as any).research as EntityResearch,
              null
            );
          }
          return NextResponse.json({
            cached: true,
            fresh: true,
            subject: cached.subject || name,
            background: cached.background,
            sources: cached.sources,
            generatedAt: cached.generatedAt,
            ttlDays: COMPANY_TTL_DAYS,
          });
        }
      }

      const biz = await workspaceContextBlock();
      const system = `${biz}You are a world-class call-preparation researcher working for the user described above. The user has a call coming up with the organisation below and needs a briefing on THAT ORGANISATION.

Use the web_search tool. Run several focused searches: the organisation's own site, what they actually do and sell, their size and stage, recent news or announcements, how their sector buys or hires, and any regulation that bears on a deal with them. Do not rely on pages you cannot read.

GROUND EVERY CLAIM in what the searches support. Never invent headcount, funding, customers, dates or positions. If something is not findable, leave it out or say plainly that it is not public. Being thin and true beats being full and wrong.

If the searches clearly land on a DIFFERENT organisation with a similar name, say so at the top and stop rather than briefing the wrong company.

Write British-English markdown, short and skimmable, with these sections:
- What they do: the real business, not their tagline.
- Size and shape: stage, scale, footprint, ownership, whatever is actually public.
- What is going on right now: recent moves, launches, funding, pressures, hires.
- How they buy: who tends to decide in an organisation like this, and what they need to see.
- Where the user's business fits, and where it does not: be honest about the misfit.
- What to watch: risks, regulation, or anything that could sink the deal.

Be specific and practical. No flattery, no padding. House style: never use em dashes or semicolons. Do not write a sources list, the system adds it.`;

      const userPrompt = `ORGANISATION: ${name || "(name unknown)"}
${website ? `Their site: ${website}` : "No site given, find them by name."}
${record && record.sector ? `Sector on file: ${record.sector}` : ""}

THE USER'S GOAL FOR THIS CALL:
${intent || "(not specified, write a general pre-call briefing)"}

Research this organisation now and write the briefing.`;

      const msg: any = await openai.messages.create({
        model: OPENAI_MODEL_THINK,
        max_tokens: 2200,
        system,
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 5 },
        ] as any,
        messages: [{ role: "user", content: userPrompt }],
      });
      await logModelUsage("research-company", "think", msg?.usage);

      const blocks: any[] = Array.isArray(msg?.content) ? msg.content : [];
      const background = houseStyle(textOf(blocks));
      const sources = collectSources(blocks);

      if (!background) {
        return NextResponse.json({
          error:
            "could not pull enough on this company to brief you, carry on without it",
        });
      }

      const research: EntityResearch = {
        subject: name || website,
        background,
        sources,
        generatedAt: new Date().toISOString(),
      };

      if (companyId) await saveCompanyResearch(companyId, research);
      if (upcomingId) await mirrorOntoUpcoming(upcomingId, research, null);

      return NextResponse.json({
        cached: false,
        fresh: true,
        subject: research.subject,
        background,
        sources,
        generatedAt: research.generatedAt,
        ttlDays: COMPANY_TTL_DAYS,
      });
    }

    // =======================================================================
    // PERSON
    // =======================================================================
    const companyId = str(body.companyId);
    const linkedinUrl = str(body.linkedinUrl);
    let person = str(body.person) || nameFromLinkedin(linkedinUrl);
    const personEmail = str(body.personEmail);
    const role = str(body.role);
    const companyRecord = await loadCompany(companyId || null);
    const company =
      str(body.company) || (companyRecord && companyRecord.name) || "";

    if (!person && !linkedinUrl && !personEmail) {
      return NextResponse.json({
        skipped: true,
        reason: "no one identified on this call yet",
      });
    }

    // The contact row is where a person's brief lives permanently, so a second
    // call with the same person never re-buys it. Created on demand.
    let contact: any = null;
    if (str(body.contactId)) {
      const { data } = await supabaseAdmin
        .from("contacts")
        .select("id, name, role, email, company_id, attributes")
        .eq("id", str(body.contactId))
        .maybeSingle();
      contact = data || null;
    }
    if (!contact) {
      contact = await resolveContact({
        companyId: companyId || null,
        name: person,
        email: personEmail,
        role,
        create: true,
      });
    }
    if (contact && !person && contact.name) person = contact.name;

    // ---- IDENTIFY ----------------------------------------------------------
    if (body.stage !== "brief") {
      if (contact && !force) {
        const cached = personState(contact);
        if (cached.have && cached.fresh) {
          if (upcomingId) {
            await mirrorOntoUpcoming(
              upcomingId,
              null,
              (contact.attributes as any).research as EntityResearch
            );
          }
          return NextResponse.json({
            decision: "cached",
            cached: true,
            fresh: true,
            contactId: contact.id,
            subject: cached.subject || person,
            background: cached.background,
            sources: cached.sources,
            generatedAt: cached.generatedAt,
            ttlDays: PERSON_TTL_DAYS,
          });
        }
      }

      const idBits = [
        person ? `Name: ${person}` : "",
        role ? `Role as known: ${role}` : "",
        company ? `Company or organisation: ${company}` : "",
        personEmail ? `Work email domain: ${personEmail.split("@")[1] || ""}` : "",
        linkedinUrl
          ? `LinkedIn, an identity hint only, do not assume its contents: ${linkedinUrl}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      const idSystem = `You are verifying WHO a person is before a deeper brief is written. Use the web_search tool to find the ONE real individual that matches the details below, using the company, role and any LinkedIn hint to disambiguate a common name. Return ONLY compact JSON and nothing else: {"found": true or false, "name": "...", "headline": "their main current role", "org": "their main organisation", "location": "city and country", "confidence": "high or medium or low"}. Use "high" ONLY when the company or role independently corroborates the match. If you cannot confidently find them, return {"found": false}. House style: never use em dashes or semicolons.`;

      // PRO, not THINK. Deciding which real person matches a name, a company
      // and a role is disambiguation, not strategy, and it returns five short
      // JSON fields. Terra does it as well as Sol for about 40 percent less.
      // The brief below stays on Sol, where the thinking actually happens.
      const idMsg: any = await openai.messages.create({
        model: OPENAI_MODEL_PRO,
        max_tokens: 400,
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
      await logModelUsage("research-person-id", "pro", idMsg?.usage);

      const identity = parseJsonish(
        textOf(Array.isArray(idMsg?.content) ? idMsg.content : [])
      ) || { found: false };

      if (!identity.found) {
        return NextResponse.json({
          decision: "none",
          contactId: contact ? contact.id : null,
          identity,
          error:
            "could not pin down who that is, add their company or paste their LinkedIn",
        });
      }

      const confidence = String(identity.confidence || "").toLowerCase();
      return NextResponse.json({
        decision: confidence === "high" ? "auto" : "confirm",
        contactId: contact ? contact.id : null,
        identity,
      });
    }

    // ---- BRIEF -------------------------------------------------------------
    const identity = body.identity && typeof body.identity === "object"
      ? body.identity
      : {};
    const subjectName = str(identity.name) || person;
    const subjectOrg = str(identity.org) || company;

    const idBits = [
      subjectName ? `Name: ${subjectName}` : "",
      str(identity.headline) ? `Current role: ${identity.headline}` : role ? `Role as known: ${role}` : "",
      subjectOrg ? `Company or organisation: ${subjectOrg}` : "",
      str(identity.location) ? `Based: ${identity.location}` : "",
      linkedinUrl
        ? `LinkedIn, an identity hint only, do not assume its contents: ${linkedinUrl}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const biz = await workspaceContextBlock();
    const system = `${biz}You are a world-class call-preparation researcher and strategist working for the user described above. The user is about to have a call and wants a sharp brief on the person they will be speaking with.

Use the web_search tool to research this person across the OPEN WEB. Run several focused searches, their name with their company, their name with their role or sector, the organisations they are linked to. Do NOT rely on LinkedIn page contents, you cannot read them, search the wider web instead.

DISAMBIGUATION IS THE MOST IMPORTANT THING. The identity below has already been verified, so stay locked onto THAT individual. If a search result is clearly a different person of the same name, discard it. Never blend two people into one.

ONLY use professional, public information, roles, career, public work, stated views, organisations. Do not include private, personal or sensitive information.

GROUND EVERY FACTUAL CLAIM in what the searches actually support. Do not invent roles, employers, dates or achievements. If you are unsure of something, hedge or leave it out.

Write the brief tailored to the user's GOAL FOR THIS CALL. British-English markdown, short skimmable sections:
- Who they really are: the substance beyond a self-description.
- What they care about and how they operate: values, style, what moves them.
- The winning frame for this call: how to position the user's goal so it lands with this specific person.
- Hooks into their world: concrete connections between what the user does and what this person cares about.
- Smart questions to ask them: a few that make them an ally and surface where the value or the doors are.
- The hard questions they will ask back: the toughest challenges this person will put to the user, and how to be ready.
- The right ask: the appropriate next step given who they are, not an oversell.
- Tone: one or two lines on how to pitch it.

Be specific and practical. No flattery, no padding. Open with a one line "Who this is" identity statement so the user can sanity-check the match. House style: never use em dashes or semicolons. Do not write a sources list, the system adds it.`;

    const userPrompt = `RESEARCH SUBJECT, already identity-verified:
${idBits}

THE USER'S GOAL FOR THIS CALL:
${intent || "(not specified, infer a sensible general prep and note that the goal was not given)"}

Research this person now and write the call-prep brief.`;

    const msg: any = await openai.messages.create({
      model: OPENAI_MODEL_THINK,
      max_tokens: 2600,
      system,
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 5 },
      ] as any,
      messages: [{ role: "user", content: userPrompt }],
    });
    await logModelUsage("research-person", "think", msg?.usage);

    const blocks: any[] = Array.isArray(msg?.content) ? msg.content : [];
    const background = houseStyle(textOf(blocks));
    const sources = collectSources(blocks);

    if (!background) {
      return NextResponse.json({
        error:
          "could not pull enough on this person to brief you, try adding their company or a LinkedIn link",
      });
    }

    const research: EntityResearch = {
      subject: subjectName,
      background,
      sources,
      identity,
      generatedAt: new Date().toISOString(),
    };

    if (contact) await savePersonResearch(contact.id, research);
    if (upcomingId) await mirrorOntoUpcoming(upcomingId, null, research);

    return NextResponse.json({
      cached: false,
      fresh: true,
      contactId: contact ? contact.id : null,
      subject: subjectName,
      background,
      sources,
      generatedAt: research.generatedAt,
      ttlDays: PERSON_TTL_DAYS,
    });
  } catch (err: any) {
    // Never 500 into the chain. A failed research step must degrade to "carry
    // on without it", not blow up the whole prep.
    return NextResponse.json(
      { error: err?.message || "research failed" },
      { status: 200 }
    );
  }
}
