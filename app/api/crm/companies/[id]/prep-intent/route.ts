import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { openai, OPENAI_MODEL_PRO, OPENAI_MODEL_LIVE } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { formatCommercialMemoryBlock, getCommercialMemory } from "@/lib/commercial-memory";
import { workspaceContextBlock, getLessonsBlock } from "@/lib/workspace";
import { resolveCallScope } from "@/lib/workstreams";
import { loadPrimaryAttendeeForUpcoming } from "@/lib/call-subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

// PREP-INTENT. Suggests a fresh intent for the NEXT call with a client, so the
// intent never goes stale. It reads everything we know (recent call scorecards,
// the open loops they left, the things you still owe, the strategic playbook,
// open to-dos, the email thread) and proposes a first-person intent for the
// next conversation, plus a short why. The result is cached on the company and
// reused until a newer summary exists, so reopening Prep spends no more tokens.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const companyId = params.id;
    const body = await req.json().catch(() => ({}));
    // Concise mode = a tight 1-2 sentence intent, used when the call screen
    // auto-fills the intent box on open (vs the fuller Prep-tab suggestion).
    const concise = (body as any)?.concise === true;
    const force = (body as any)?.force === true;
    const upcomingId =
      typeof (body as any)?.upcomingId === "string"
        ? (body as any).upcomingId
        : "";
    const leadResolution = upcomingId
      ? await loadPrimaryAttendeeForUpcoming(upcomingId)
      : null;
    if (upcomingId && !leadResolution?.call) {
      return NextResponse.json(
        { error: "The scheduled call could not be found." },
        { status: 404 }
      );
    }
    if (
      upcomingId &&
      String(leadResolution?.call?.company_id || "") !== companyId
    ) {
      return NextResponse.json(
        { error: "The scheduled call is not linked to this client." },
        { status: 409 }
      );
    }
    const validatedLeadEmail = String(
      leadResolution?.primaryAttendee?.email || ""
    )
      .toLowerCase()
      .trim();
    const scope = await resolveCallScope({
      companyId,
      upcomingId,
      ...(upcomingId ? { leadEmail: validatedLeadEmail } : {}),
    });
    const workstream = scope.workstream;
    let summariesQuery = supabaseAdmin
      .from("interview_summaries")
      .select("created_at, session_id, summary")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(3);
    let tasksQuery = supabaseAdmin
      .from("tasks")
      .select("text, kind, status, created_at")
      .eq("company_id", companyId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(12);
    if (workstream) {
      summariesQuery = summariesQuery.eq("workstream_id", workstream.id);
      tasksQuery = tasksQuery.eq("workstream_id", workstream.id);
    }

    const [{ data: company }, { data: thread }, { data: summaryRows }, { data: taskRows }, commercialMemoryRaw] =
      await Promise.all([
        supabaseAdmin
          .from("companies")
          .select("name, profile, email_context_updated_at")
          .eq("id", companyId)
          .single(),
        workstream
          ? supabaseAdmin
              .from("workstreams")
              .select("email_context_updated_at, email_context_meta, next_call")
              .eq("id", workstream.id)
              .single()
          : Promise.resolve({ data: null, error: null }),
        summariesQuery,
        tasksQuery,
        getCommercialMemory(companyId, workstream?.id || null),
      ]);

    if (!company) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }

    const profile = (company.profile || {}) as any;
    const emailContextMeta = workstream
      ? ((thread as any)?.email_context_meta || {})
      : profile;
    const emailContextCounterparty = String(
      emailContextMeta?.email_context_counterparty_email || ""
    )
      .toLowerCase()
      .trim();
    // Event-specific prep can use a saved email summary only when its recorded
    // counterparty is the validated lead on this exact event. Older summaries
    // without provenance remain stored, but stay out of this call's intent
    // until the normal email refresh binds them to the correct address.
    const commercialMemory =
      upcomingId &&
      commercialMemoryRaw?.email &&
      (!validatedLeadEmail ||
        emailContextCounterparty !== validatedLeadEmail)
        ? { ...commercialMemoryRaw, email: null }
        : commercialMemoryRaw;
    const playbook: string[] = !workstream && Array.isArray(profile.playbook)
      ? profile.playbook.filter((p: any) => typeof p === "string" && p.trim())
      : [];
    const summaries = summaryRows || [];
    const openTasks = (taskRows || [])
      .map((t: any) => (typeof t.text === "string" ? t.text.trim() : ""))
      .filter(Boolean);

    const newestSummaryAt = summaries[0]?.created_at || null;
    const newestEmailAt = workstream
      ? (thread as any)?.email_context_updated_at || null
      : (company as any).email_context_updated_at || null;
    const cached = workstream ? (thread as any)?.next_call : profile.next_call;
    const cacheHasLeadBinding = !!(
      cached &&
      Object.prototype.hasOwnProperty.call(cached, "basedOnLeadEmail") &&
      Object.prototype.hasOwnProperty.call(
        cached,
        "basedOnEmailContextCounterparty"
      )
    );
    const cacheMatchesLead =
      !upcomingId ||
      (cacheHasLeadBinding &&
        String(cached.basedOnLeadEmail || "").toLowerCase().trim() ===
          validatedLeadEmail &&
        String(cached.basedOnEmailContextCounterparty || "")
          .toLowerCase()
          .trim() === emailContextCounterparty);
    const cacheIsCurrent = !!(
      cached &&
      typeof cached.intent === "string" &&
      cached.intent.trim() &&
      (!newestSummaryAt ||
        cached.basedOnSummaryAt === newestSummaryAt ||
        (cached.basedOnSessionId &&
          cached.basedOnSessionId === summaries[0]?.session_id)) &&
      cached.basedOnEmailAt === newestEmailAt
      && cached.basedOnMemoryHash === (commercialMemory?.sourceHash || null)
      && cacheMatchesLead
    );

    const applyToUpcoming = async (
      intent: string,
      rationale: string,
      source: "next_call" | "generated"
    ) => {
      if (!upcomingId) return intent;
      const { data: call } = await supabaseAdmin
        .from("upcoming_calls")
        .select("company_id, intent, prep")
        .eq("id", upcomingId)
        .maybeSingle();
      if (!call || String(call.company_id || "") !== companyId) {
        throw new Error("The scheduled call is not linked to this client.");
      }
      const prep = call?.prep && typeof call.prep === "object" ? call.prep : {};
      const meta = (prep as any).intentMeta;
      // Once the user edits this occurrence, their words win.
      if (meta?.source === "manual") return String(call?.intent || intent);
      await supabaseAdmin
        .from("upcoming_calls")
        .update({
          intent,
          prep: {
            ...prep,
            intentMeta: {
              source,
              basedOnSummaryAt: newestSummaryAt,
              leadEmail: validatedLeadEmail || null,
              rationale,
              savedAt: new Date().toISOString(),
            },
          },
        })
        .eq("id", upcomingId);
      return intent;
    };

    if (cacheIsCurrent && !force) {
      const cachedIntent = await applyToUpcoming(
        cached.intent.trim(),
        typeof cached.rationale === "string" ? cached.rationale : "",
        "next_call"
      );
      return NextResponse.json({
        intent: cachedIntent,
        rationale: typeof cached.rationale === "string" ? cached.rationale : "",
        cached: true,
        fallback: false,
      });
    }

    // Don't burn a model call on an empty record - tell the user what to add.
    const hasMaterial =
      summaries.length > 0 ||
      openTasks.length > 0 ||
      playbook.length > 0 ||
      (typeof profile.brief === "string" ? profile.brief.trim() : "") ||
      (Array.isArray(profile.brief) && profile.brief.length > 0);
    const hasCommercialMaterial = !!(
      commercialMemory?.relationship ||
      commercialMemory?.lastCall ||
      commercialMemory?.email ||
      commercialMemory?.outreach ||
      commercialMemory?.opportunity ||
      commercialMemory?.stakeholders?.length ||
      commercialMemory?.openActions.length ||
      commercialMemory?.addedContext.length
    );
    if (!hasMaterial && !hasCommercialMaterial) {
      return NextResponse.json(
        {
          error:
            "nothing to prep from yet - link a call, add notes or pull the email thread first",
        },
        { status: 422 }
      );
    }

    // Build an explicit OPEN LOOPS block from the recent scorecards. This is the
    // raw material a good next-call intent is made of: what you still owe, what
    // they said they'd do (to chase), the smart moves suggested, and what was
    // never covered. The general context string carries the rest.
    const arr = (v: any): string[] =>
      Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];
    const fmtDate = (iso: string) => {
      try {
        return new Date(iso).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
      } catch {
        return iso?.slice(0, 10) || "";
      }
    };

    const loopLines: string[] = [];
    summaries.forEach((row: any, i: number) => {
      const s = row.summary || {};
      const when = row.created_at ? fmtDate(row.created_at) : "";
      const head = i === 0 ? "MOST RECENT CALL" : "EARLIER CALL";
      const parts: string[] = [`${head} (${when}): ${s.headline || "no headline"}`];
      const mine = arr(s.myNextActions);
      const theirs = arr(s.theirNextActions);
      const sugg = arr(s.suggestedNextActions);
      const gaps = arr(s.notCovered);
      if (mine.length) parts.push(`  You still owe: ${mine.join(" | ")}`);
      if (theirs.length) parts.push(`  They said they'd: ${theirs.join(" | ")}`);
      if (sugg.length) parts.push(`  Smart next moves: ${sugg.join(" | ")}`);
      if (gaps.length) parts.push(`  Not yet covered: ${gaps.join(" | ")}`);
      loopLines.push(parts.join("\n"));
    });
    const openLoopsBlock = loopLines.length
      ? loopLines.join("\n\n")
      : "No past call scorecards on file for this client yet.";

    // The scheduled call's existing intent is deliberately excluded. It may be
    // the stale text we are here to replace and must never compete with the
    // newest scorecard and its open actions.
    const context = formatCommercialMemoryBlock(commercialMemory);

    const biz = await workspaceContextBlock();
    const lessons = await getLessonsBlock(["strategy", "negotiation"]);
    const system = `${biz}${lessons}You are preparing the host for their NEXT call with this client. Write the host's INTENT for that next call, in their own first-person voice, grounded ONLY in the context below.

The intent is the single most important input to the call: it drives the focus, the live cues and the post-call score. So it must be current and specific to where this relationship actually is right now, not generic. Carry forward the open loops from the last call: what the host still owes, what the other side said they would do (to chase), the smart next move from the playbook, and the things not yet covered. Aim it at the outcome the host wants with this client.

Output ONLY JSON with exactly these keys:
{
  "intent": "the intent for the next call, first person, ${
    concise
      ? "1 to 2 short, tight sentences, nice and concise"
      : "2 to 5 sentences"
  }. What the host wants from THIS call and why now, anchored to the outstanding threads. Concrete, not generic.",
  "rationale": "one or two sentences naming what is still outstanding since the last call that shaped this intent, so the host can sanity-check it at a glance."
}

Rules:
- Ground everything only in the context. Never invent facts, names, numbers, dates or commitments. If the record is thin, write a sensible opening intent and say in the rationale that there is little history yet.
- The MOST RECENT CALL and its unfinished actions are authoritative. If older profile, email, research or playbook context conflicts with them, follow the most recent call.
- Never repeat or lightly rephrase an old discovery intent merely because a similarly titled meeting is upcoming.
- Plain English. No markdown, no headings, no bold. No em-dashes or semicolons, use commas and full stops.
- Write the intent as the host would say it ("I want to ...", "I need to ..."), not as instructions to them.`;

    const userMsg = `CLIENT: ${company.name}
${workstream ? `DEPARTMENT: ${workstream.departmentName || "not set"}\nWORKSTREAM: ${workstream.name}\nPURPOSE: ${workstream.purpose || "not set"}` : ""}

OPEN LOOPS FROM RECENT CALLS:
${openLoopsBlock}

OPEN TO-DOS ON FILE FOR THIS CLIENT:
${openTasks.length ? openTasks.map((t) => `- ${t}`).join("\n") : "none recorded"}

STRATEGIC PLAYBOOK FOR THIS CLIENT:
${playbook.length ? playbook.map((p, i) => `${i + 1}. ${p}`).join("\n") : "none recorded"}

EVERYTHING ELSE WE KNOW (profile, email thread, opportunities, notes):
${context}

Return the JSON now.`;

    // Deterministic fallback so a timeout never leaves the user empty-handed:
    // stitch the freshest open loops and to-dos into a usable starting intent.
    const buildFallback = (): { intent: string; rationale: string } => {
      const top = summaries[0]?.summary || {};
      const owe = arr(top.myNextActions).slice(0, 3);
      const chase = arr(top.theirNextActions).slice(0, 2);
      const moves = arr(top.suggestedNextActions).slice(0, 2);
      const gaps = arr(top.notCovered).slice(0, 2);
      const bits: string[] = [];
      if (owe.length) bits.push(`follow through on ${owe.join(", ")}`);
      if (chase.length) bits.push(`check where they got to on ${chase.join(", ")}`);
      if (moves.length) bits.push(moves.join(", "));
      if (gaps.length) bits.push(`cover ${gaps.join(", ")}`);
      if (!bits.length && openTasks.length)
        bits.push(openTasks.slice(0, 3).join(", "));
      const intent = bits.length
        ? `For this next call with ${company.name}${workstream ? ` about ${workstream.name}` : ""} I want to ${bits.join(
            ", and "
          )}.`
        : `Reconnect with ${company.name}, take stock of where things stand and agree the next concrete step.`;
      return {
        intent,
        rationale:
          "Assembled from the latest call's open actions and your to-dos. The AI suggestion timed out, so review this before using it.",
      };
    };

    let intent = "";
    let rationale = "";
    let fallback = false;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 34000);
      try {
        const msg = await openai.messages.create(
          {
            // Concise = the auto-fill on call open (fires often), so use the fast
            // cheap model. The fuller Prep-tab suggestion stays on the pro model.
            model: concise ? OPENAI_MODEL_LIVE : OPENAI_MODEL_PRO,
            max_tokens: concise ? 320 : 700,
            temperature: 0.4,
            system,
            messages: [{ role: "user", content: userMsg }],
          },
          { signal: controller.signal }
        );
        await logModelUsage(
          "prep-intent",
          concise ? "live" : "pro",
          (msg as any).usage
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
        if (parsed && typeof parsed.intent === "string" && parsed.intent.trim()) {
          intent = parsed.intent.trim();
          rationale =
            typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      console.error("prep-intent pass failed:", e);
    }

    if (!intent) {
      const fb = buildFallback();
      intent = fb.intent;
      rationale = fb.rationale;
      fallback = true;
    }

    // Keep the house style even if the model slips (no em/en dashes, no semicolons).
    const tidy = (s: string) =>
      s
        .replace(/[—–]/g, ", ")
        .replace(/;/g, ",")
        .replace(/\s+([,.])/g, "$1")
        .replace(/,\s*,/g, ",")
        .replace(/\s{2,}/g, " ")
        .trim();

    const cleanIntent = tidy(intent);
    const cleanRationale = rationale ? tidy(rationale) : "";
    const nextCall = {
      intent: cleanIntent,
      rationale: cleanRationale,
      basedOnSummaryAt: newestSummaryAt,
      basedOnEmailAt: newestEmailAt,
      basedOnMemoryHash: commercialMemory?.sourceHash || null,
      basedOnLeadEmail: validatedLeadEmail || null,
      basedOnEmailContextCounterparty: emailContextCounterparty || null,
      generatedAt: new Date().toISOString(),
    };
    if (workstream) {
      await supabaseAdmin
        .from("workstreams")
        .update({ next_call: nextCall, updated_at: new Date().toISOString() })
        .eq("id", workstream.id);
    } else {
      await supabaseAdmin
        .from("companies")
        .update({ profile: { ...profile, next_call: nextCall } })
        .eq("id", companyId);
    }
    const appliedIntent = await applyToUpcoming(
      cleanIntent,
      cleanRationale,
      "generated"
    );

    return NextResponse.json({
      intent: appliedIntent,
      rationale: cleanRationale,
      cached: false,
      fallback,
      basedOn: {
        calls: summaries.length,
        openTasks: openTasks.length,
        playbook: playbook.length,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to suggest an intent" },
      { status: 500 }
    );
  }
}
