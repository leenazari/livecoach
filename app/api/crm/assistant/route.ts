import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_PRO, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";
import { gatherClientContext, gatherGlobalContext } from "@/lib/crm-context";
import { workspaceContextBlock, getLessonsBlock, getBrainQuestions } from "@/lib/workspace";
import { upsertTasks, actionToLinkKind } from "@/lib/tasks";
import { logModelUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 40;

// The CRM assistant. With a companyId it's grounded in that ONE client; without
// one it's GLOBAL - it knows every client + your whole pipeline, so you can just
// talk ("show Alan's to-do", "what's my to-do list", "which deal is closest").
// Always explains its reasoning. Drafts on request. Stores the thread (global
// thread = company_id null).
// Resolve a proposed write action's target by NAME/TITLE (never an id the model
// guessed) to a real record, and return a ready-to-fire request the CLIENT runs
// only after the user taps Confirm. Nothing here writes to the database.
function likeTerm(s: string): string {
  return String(s || "").replace(/[%_]/g, "").trim().slice(0, 60);
}
async function findCalls(title: string): Promise<any[]> {
  const term = likeTerm(title);
  if (!term) return [];
  const { data } = await supabaseAdmin
    .from("upcoming_calls")
    .select("id, title, scheduled_at")
    .ilike("title", `%${term}%`)
    .gte("scheduled_at", new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(4);
  return Array.isArray(data) ? data : [];
}
function callWhen(iso: string): string {
  if (!iso) return "no time set";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "no time set";
  }
}
async function findCompany(name: string) {
  const term = likeTerm(name);
  if (!term) return null;
  const { data } = await supabaseAdmin
    .from("companies")
    .select("id, name")
    .ilike("name", `%${term}%`)
    .limit(1);
  return data && data[0] ? data[0] : null;
}
async function findOpenTask(text: string) {
  const term = likeTerm(text);
  if (!term) return null;
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("id, text")
    .eq("status", "open")
    .ilike("text", `%${term}%`)
    .limit(1);
  return data && data[0] ? data[0] : null;
}
async function findDraft(subject: string) {
  const term = likeTerm(subject);
  if (!term) return null;
  const { data } = await supabaseAdmin
    .from("follow_ups")
    .select("id, draft_subject")
    .eq("status", "draft")
    .ilike("draft_subject", `%${term}%`)
    .limit(1);
  return data && data[0] ? data[0] : null;
}
// Build the ready-to-fire request for a call-targeting action against ONE call.
function callExec(call: any, type: string, x: any) {
  if (type === "set_meeting_link")
    return { endpoint: `/api/crm/upcoming/${call.id}`, method: "PATCH", body: { meetingUrl: x.url } };
  if (type === "set_intent")
    return { endpoint: `/api/crm/upcoming/${call.id}`, method: "PATCH", body: { intent: x.intent } };
  if (type === "link_call")
    return { endpoint: `/api/crm/upcoming/${call.id}`, method: "PATCH", body: { companyId: x.companyId } };
  // cancel_call
  return { endpoint: `/api/crm/upcoming/${call.id}/cancel`, method: "POST", body: { reason: x.reason } };
}
function actionVerb(type: string): string {
  return type === "set_meeting_link"
    ? "attach the link to"
    : type === "set_intent"
    ? "set the intent on"
    : type === "link_call"
    ? "link"
    : "remove";
}

async function resolveActions(items: any[]): Promise<any[]> {
  const out: any[] = [];
  const callTypes = ["set_meeting_link", "set_intent", "link_call", "cancel_call"];
  for (const it of Array.isArray(items) ? items : []) {
    if (out.length >= 6) break;
    if (!it || typeof it.type !== "string") continue;
    const key = Math.random().toString(36).slice(2);

    if (callTypes.includes(it.type)) {
      const calls = await findCalls(String(it.call || ""));
      if (!calls.length) continue;
      // Gather the extras each action needs; skip if a required one is missing.
      const x: any = {};
      let detail = "";
      if (it.type === "set_meeting_link") {
        const url = typeof it.url === "string" ? it.url.trim() : "";
        if (!url) continue;
        x.url = url;
        detail = `: ${url}`;
      } else if (it.type === "set_intent") {
        x.intent = typeof it.intent === "string" ? it.intent.trim() : "";
        detail = x.intent ? `: ${x.intent}` : " (clear it)";
      } else if (it.type === "link_call") {
        const company = await findCompany(String(it.client || ""));
        if (!company) continue;
        x.companyId = company.id;
        detail = ` to ${company.name}`;
      } else if (it.type === "cancel_call") {
        x.reason = typeof it.reason === "string" ? it.reason.trim() : "";
        detail = x.reason ? ` (reason: ${x.reason})` : " (off the calendar)";
      }
      const verb = actionVerb(it.type);
      if (calls.length === 1) {
        const ex = callExec(calls[0], it.type, x);
        out.push({
          key,
          type: it.type,
          label: `${verb.charAt(0).toUpperCase()}${verb.slice(1)} "${calls[0].title}"${detail}`,
          endpoint: ex.endpoint,
          method: ex.method,
          body: ex.body,
        });
      } else {
        // Ambiguous - more than one matching call. Ask the user which one
        // rather than guessing (the "which Joydeep call?" case).
        out.push({
          key,
          type: it.type,
          label: `More than one call matches. Which one should I ${verb}${detail}?`,
          choices: calls.slice(0, 4).map((c: any) => {
            const ex = callExec(c, it.type, x);
            return {
              label: `${c.title || "call"} - ${callWhen(c.scheduled_at)}`,
              endpoint: ex.endpoint,
              method: ex.method,
              body: ex.body,
            };
          }),
        });
      }
      continue;
    }

    if (it.type === "remember") {
      const note = typeof it.note === "string" ? it.note.trim() : "";
      if (note)
        out.push({
          key,
          type: it.type,
          label: `Remember this: ${note}`,
          endpoint: `/api/crm/brain/remember`,
          method: "POST",
          body: { note },
        });
      continue;
    }

    if (it.type === "dismiss") {
      if (it.kind === "draft") {
        const d = await findDraft(String(it.item || ""));
        if (d)
          out.push({
            key,
            type: it.type,
            label: `Dismiss draft: "${d.draft_subject || "(no subject)"}"`,
            endpoint: `/api/crm/follow-ups/${d.id}`,
            method: "PATCH",
            body: { status: "dismissed" },
          });
      } else {
        const t = await findOpenTask(String(it.item || ""));
        if (t)
          out.push({
            key,
            type: it.type,
            label: `Dismiss to-do: "${t.text}"`,
            endpoint: `/api/crm/tasks/${t.id}`,
            method: "PATCH",
            body: { status: "dismissed" },
          });
      }
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, focusCompanyId, message } = await req.json();
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }
    const isGlobal = typeof companyId !== "string" || !companyId;

    // On a client page we lead with that client, but still load the wider
    // pipeline so the user can range onto anyone or anything (the assistant is
    // their co-founder, not a single-client bot).
    // The client to LEAD with (the page the user is on) - from focusCompanyId
    // (persistent layout assistant) or companyId (legacy/call-screen scoping).
    // The conversation thread itself stays global unless companyId is set.
    const focus =
      typeof focusCompanyId === "string" && focusCompanyId
        ? focusCompanyId
        : typeof companyId === "string" && companyId
        ? companyId
        : null;
    // Recent thread for continuity. Global thread = rows with company_id null.
    let histQ = supabaseAdmin
      .from("assistant_messages")
      .select("role, content")
      .order("created_at", { ascending: false })
      .limit(10);
    histQ = isGlobal
      ? histQ.is("company_id", null)
      : histQ.eq("company_id", companyId);

    const gatherContext = async (): Promise<string | null> => {
      if (focus) {
        const [client, pipeline] = await Promise.all([
          gatherClientContext(focus),
          gatherGlobalContext(),
        ]);
        return client
          ? `FOCUSED CLIENT - the page the user is on. Lead here when the question is about them:\n\n${client}\n\n----------\n\nTHE WIDER PIPELINE - everyone else and the whole book. Use this when the user ranges beyond this client (another client, a new idea, their week ahead):\n\n${pipeline}`
          : pipeline;
      }
      return gatherGlobalContext();
    };

    // Everything the model needs, fetched in PARALLEL instead of one-after-
    // another. These were sequential DB round-trips that slowed every reply.
    const [context, histRes, biz, lessons, brainQuestions] = await Promise.all([
      gatherContext(),
      histQ,
      workspaceContextBlock(),
      getLessonsBlock(["negotiation", "strategy", "psychology"]),
      getBrainQuestions(),
    ]);
    if (!context) {
      return NextResponse.json({ error: "client not found" }, { status: 404 });
    }
    const history = (histRes as any)?.data;
    const priorTurns: { role: "user" | "assistant"; content: string }[] = (
      history || []
    )
      .reverse()
      .map((m: any) => ({
        role: (m.role === "assistant" ? "assistant" : "user") as
          | "user"
          | "assistant",
        content: String(m.content),
      }));

    const scope = isGlobal
      ? `You are the user's overall CRM assistant. You know ALL their clients and their whole pipeline (below). They might ask about one client ("what do I do next with Alaine"), or across everyone ("what's my to-do list", "which deal is closest to closing"). When they name a client, match it to the closest one in the context even if the spelling is slightly off, and answer about them. When the question is across the board, pull from everyone.`
      : `You are the user's strategic co-founder and CRM assistant. They are currently on ONE client's page, so by default answer about that client (the FOCUSED CLIENT below) and help move that relationship forward. But you are NOT limited to them - the user may bring up another client, a fresh idea, their week, or anything at all, and you should help with whatever they raise, drawing on the wider pipeline below. Whatever the topic, help them plan, prep and take action.`;
    const qBlock = brainQuestions
      ? `\n\nTHINGS YOU ARE TRYING TO LEARN (open questions about the user's business that would make you sharper). When it fits naturally, when the user asks what you need, or when you are brainstorming, raise one or two of these - never the whole list and never force them. When the user answers, weave it into your reply and treat it as fact from then on:\n${brainQuestions}`
      : "";
    const system: any[] = [
      {
        type: "text",
        text: `${biz}${lessons}${scope}${qBlock}

GROUND EVERYTHING in the context provided below. This is the hardest rule and it overrides being helpful.
- Never state a specific number, money amount, budget, deal value, date, deadline, percentage, stage, name or commitment unless it appears literally in the context. Do not estimate, assume, or infer a figure that isn't written there. If you catch yourself about to put a number in a sentence, check it is actually in the context first.
- If a piece of information is missing (no budget, no stage, no value, no next step recorded), say it is not recorded yet. Do NOT fill the gap with a plausible-sounding guess. "You haven't logged a budget for them" is a good answer. Inventing "a $200k budget" is a serious error.
- When a client's record is thin or empty, say so directly and tell the user what to capture first (link a call, set a stage, note the next step). Do not pad a near-empty record into multiple confident options or a detailed plan built on assumptions. A short honest answer beats a long invented one.
- If you are unsure whether something is in the context, treat it as not there and say so.

MATCH THE REQUEST - this is important. Answer exactly what was asked and NO MORE. If the user makes a simple or operational request (add a to-do, set a reminder, a quick lookup, a yes or no, attach a link, dismiss something), respond in one or two lines, and if you need a detail to do it, ask the SINGLE question. Do NOT volunteer a priorities list, a week plan, a deal-by-deal briefing, or strategic advice they did not ask for. For "I need to add something to my to-do list" the right reply is simply "Sure, what is it?" - not a summary of their week. Save the bigger thinking for when they actually ask for advice, a plan, or what to prioritise. Over-answering a small request is a mistake.

DO NOT REPEAT YOURSELF - this is critical. You can see the whole conversation. NEVER restate a plan, a list, or advice you have already given in this thread. When the user adds a small fact, a name, or a correction (for example "Ajith Kumar is the director", "Joydeep was not sick"), acknowledge it in ONE short line and add ONLY what genuinely changes as a result - do NOT regenerate the earlier plan with the new detail swapped in. If the new detail doesn't materially change your earlier advice, say that in a sentence and stop (e.g. "Got it, I'll address it to Ajith - everything else we said still stands."). Re-delivering a long answer the user has already read wastes their time and is a serious mistake. Build on what's been said, never repeat it.

EXPLAIN THE WHY. When the user DOES ask for advice or a next step, work the reasoning into your sentences so they learn the thinking, not just the instruction. Say what in the history makes it the right move. Do this in plain prose, not under a "Why:" label.

BE CONCRETE: real steps, who to contact, roughly when, what to say. When you suggest an order, explain it in a sentence.

HOW TO WRITE (this matters a lot - the user finds over-formatted answers robotic):
- Write the way a sharp colleague talks. Short paragraphs of plain sentences. Usually two to four short paragraphs is plenty.
- Do NOT use markdown formatting. No "#" or "##" headings. No "**bold**". No markdown tables.
- Avoid bullet-point and numbered lists unless the user explicitly asks for a list. Prefer flowing sentences. If you genuinely must list a few items, keep it to plain short lines with no bold.
- Never write words in all-caps for emphasis (no "TODAY", "NOW"). Don't shout.
- Never use em-dashes or semicolons. Use commas and full stops instead.
- Lead with the single most useful thing. Cut filler and preamble. Don't pad to sound thorough.

DRAFTS - ONLY WHEN ASKED (this keeps replies fast): do NOT write a full email, message or document unless the user EXPLICITLY asks you to draft, write, or send one. For a normal question, answer concisely and, if a draft would help, OFFER it in a single line ("want me to draft that email?") rather than writing it. Writing a long draft nobody asked for is slow and wasteful. When they DO ask you to draft something, put ONLY that sendable text between these exact marker lines:
---DRAFT---
<the sendable text only - for an email include a "Subject:" line then the body>
---END DRAFT---
Keep your commentary and reasoning OUTSIDE the markers. The text inside the markers can be plain and clean since it is what gets sent.

TO-DOS: when the user asks you to arrange, remember, chase, follow up, add, draft, prep, or otherwise CREATE actions to do later, capture each as a to-do. In ADDITION to your normal prose reply, put ONLY a JSON array between these exact markers:
---TASKS---
[{"text":"short imperative to-do","action":"email|call|task"}]
---END TASKS---
Use "email" for anything to write or send, "call" to prep or schedule a call, "task" for anything else. Only create to-dos the user actually wants tracked, and do not repeat ones already shown as outstanding in the context. They appear on the user's to-do list with the action attached, to trigger when they choose. Keep these markers out of your prose, and still answer naturally.

CALENDAR: the user's upcoming calls, synced from their calendar, are in the context below in the calls list, each with its join link when there is one. Answer "what's on my calendar" / "what's next" from that, and give the join link when asked. You cannot edit their Google calendar itself, but you CAN, with their confirmation, attach or change the meeting link, set or clear the intent, or link a call to a client on the in-app call record (see ACTIONS). If they tell you a call moved or was cancelled, note it or add a to-do, and remind them the synced view refreshes from their calendar.

ACTIONS YOU CAN TAKE (always with the user's confirmation - never claim you already did them): when the user explicitly asks you to attach or change a meeting link on a call, set or clear a call's intent, link a call to a client, cancel/remove a call that is no longer happening (it was cancelled or already happened separately) and note why, or dismiss a draft or a to-do, propose it. ALSO watch for the user stating a durable PREFERENCE, habit, standard practice, rule, or lasting fact about how they work or their business (for example "I wait 48 hours before chasing a follow-up", "I never call before 10am", "always cc Mark on proposals", "my standard pilot is two weeks"). When they do, offer to REMEMBER it with a "remember" action so it sticks for future plans, cues and chats - acknowledge it in your prose AND propose saving it; never save silently. In ADDITION to a short prose reply, put ONLY a JSON array between these exact markers:
---ACTIONS---
[{"type":"set_meeting_link","call":"<call title or person from the context>","url":"<link>"},{"type":"set_intent","call":"<call title>","intent":"<intent text, empty to clear>"},{"type":"link_call","call":"<call title>","client":"<client name>"},{"type":"cancel_call","call":"<call title>","reason":"<why it is not happening, optional>"},{"type":"dismiss","kind":"draft","item":"<the draft subject>"},{"type":"dismiss","kind":"task","item":"<the to-do text>"},{"type":"remember","note":"<the durable preference, habit, standard practice or fact to save, in one clear line>"}]
---END ACTIONS---
When a call is cancelled or has moved off the calendar, use cancel_call (it removes the call and its prep to-do and records the reason). If there are also leftover to-dos or drafts about that call, propose dismissing those too. If you are not sure which call, client, draft or to-do the user means, ask them to clarify in your prose reply rather than guessing (the system will also offer a pick-list if more than one record matches the name).
Refer to the call, client, draft or to-do by the exact name/title/text shown in the context so it can be matched. Only include the actions the user actually asked for. Each one is shown to the user with a Confirm button and nothing happens until they tap it, so never say it is done. Keep these markers out of your prose and still reply naturally.

TONE: warm, sharp, brief. Plain English, like a smart colleague who knows the book of business well and respects your time.

SPOKEN SUMMARY: the user often listens to your reply by voice, and hearing the whole thing read out is long winded (especially for a game plan or a list). So ALWAYS also give a SHORT spoken version - one or two sentences that carry the gist and the single most useful point, in a natural talking voice. Put ONLY that between these exact markers:
---SPOKEN---
<one or two spoken sentences>
---END SPOKEN---
NEVER read out a full draft or email in the spoken version. If you wrote a draft, the spoken version should just say a draft is ready and ASK if they want you to read it out. Keep these markers out of your visible prose. The full written answer still goes in your normal reply.`,
      },
      {
        type: "text",
        text: `${isGlobal ? "PIPELINE CONTEXT" : "CONTEXT"} (everything we know):\n\n${context}`,
        cache_control: { type: "ephemeral" },
      },
    ];

    const messages = [
      ...priorTurns,
      { role: "user" as const, content: message.trim() },
    ];

    // Route obvious data lookups (your to-do list, what's on the calendar) to the
    // FAST model - it is only reading the context that is already here. Anything
    // that creates, judges, plans, drafts, advises, compares or summarises stays
    // on the smart model, since that is the part that matters.
    const ml = message.toLowerCase();
    const LOOKUP =
      /(to.?do|task list|my tasks|what.?s on|what.?s next|what is next|upcoming|my calls?|my schedule|my calendar|show me|^list\b|list (my|the)|my drafts|my commitments|what do i owe|outstanding|who have i)/;
    const SMART =
      /(draft|write|email|message|plan|prep|summari[sz]e|advi[sc]e|should i|why|how (do|should|can|to|would)|best|strateg|recommend|opinion|brainstorm|idea|pitch|negoti|approach|think|compare|priorit|win\b|risk|objection|pros|cons)/;
    const simple = LOOKUP.test(ml) && !SMART.test(ml);
    const model = simple ? CLAUDE_MODEL_LIVE : CLAUDE_MODEL_PRO;
    const maxTok = simple ? 800 : 1300;

    // STREAM the reply so words appear as they are written. We emit newline-
    // delimited JSON frames: {type:"delta",text} as the model writes, then one
    // {type:"done", reply, spoken, createdTasks, proposedActions} once the full
    // text is in and we have run the to-do / action / spoken extraction.
    const encoder = new TextEncoder();
    const frame = (
      controller: ReadableStreamDefaultController,
      obj: any
    ) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

    const streamBody = new ReadableStream({
      async start(controller) {
        let full = "";
        try {
          const aStream: any = (anthropic as any).messages.stream({
            model,
            max_tokens: maxTok,
            temperature: 0.4,
            system,
            messages,
          });
          for await (const ev of aStream) {
            if (
              ev?.type === "content_block_delta" &&
              ev?.delta?.type === "text_delta"
            ) {
              const t = ev.delta.text || "";
              if (t) {
                full += t;
                frame(controller, { type: "delta", text: t });
              }
            }
          }
          let usage: any = null;
          try {
            const fm = await aStream.finalMessage();
            usage = fm?.usage;
            if (!full && Array.isArray(fm?.content)) {
              full = fm.content
                .filter((b: any) => b.type === "text")
                .map((b: any) => b.text)
                .join("");
            }
          } catch {
            /* ignore - we still have `full` from the deltas */
          }
          await logModelUsage("assistant", simple ? "haiku" : "sonnet", usage);

          let reply = full.trim();

          // --- TO-DOS: create them (deduped) and strip the markers ---
          let createdTasks: any[] = [];
          const tm = reply.match(/---TASKS---\s*([\s\S]*?)\s*---END TASKS---/);
          if (tm) {
            reply = reply.replace(/---TASKS---[\s\S]*?---END TASKS---/, "").trim();
            try {
              const seg = tm[1];
              const a = seg.indexOf("[");
              const b = seg.lastIndexOf("]");
              const arr = a >= 0 && b > a ? JSON.parse(seg.slice(a, b + 1)) : [];
              if (Array.isArray(arr)) {
                const items = arr
                  .filter((x: any) => x && typeof x.text === "string" && x.text.trim())
                  .slice(0, 12)
                  .map((x: any) => ({
                    text: String(x.text).trim(),
                    linkKind: actionToLinkKind(x.action),
                    source: "assistant",
                  }));
                createdTasks = await upsertTasks(isGlobal ? null : companyId, items);
              }
            } catch {
              /* ignore a malformed task block */
            }
          }

          // --- WRITE ACTIONS: resolve targets, never execute (client confirms) ---
          let proposedActions: any[] = [];
          const am = reply.match(/---ACTIONS---\s*([\s\S]*?)\s*---END ACTIONS---/);
          if (am) {
            reply = reply.replace(/---ACTIONS---[\s\S]*?---END ACTIONS---/, "").trim();
            try {
              const seg = am[1];
              const a = seg.indexOf("[");
              const b = seg.lastIndexOf("]");
              const arr = a >= 0 && b > a ? JSON.parse(seg.slice(a, b + 1)) : [];
              proposedActions = await resolveActions(arr);
            } catch {
              /* ignore a malformed action block */
            }
          }

          // --- SPOKEN summary (tolerant of a malformed close) ---
          let spoken = "";
          const spIdx = reply.indexOf("---SPOKEN---");
          if (spIdx !== -1) {
            let after = reply.slice(spIdx + "---SPOKEN---".length);
            reply = reply.slice(0, spIdx).trim();
            after = after
              .replace(/---END SPOKEN---[\s\S]*$/, "")
              .replace(/---SPOKEN---[\s\S]*$/, "");
            spoken = after.trim();
          }
          // Safety net: never let stray SPOKEN / TASKS / ACTIONS markers remain.
          reply = reply
            .replace(/---END (SPOKEN|TASKS|ACTIONS)---/g, "")
            .replace(/---(SPOKEN|TASKS|ACTIONS)---/g, "")
            .trim();

          if (!reply)
            reply = createdTasks.length
              ? `Added ${createdTasks.length} to your to-do list.`
              : "Sorry, I couldn't form a reply just then. Try again?";

          await supabaseAdmin.from("assistant_messages").insert([
            {
              company_id: isGlobal ? null : companyId,
              role: "user",
              content: message.trim(),
            },
            {
              company_id: isGlobal ? null : companyId,
              role: "assistant",
              content: reply,
            },
          ]);

          frame(controller, {
            type: "done",
            reply,
            spoken,
            createdTasks,
            proposedActions,
          });
        } catch (e: any) {
          console.error("Assistant stream failed:", e);
          frame(controller, {
            type: "error",
            error: "the assistant failed just then - try again",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(streamBody, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "assistant failed" },
      { status: 500 }
    );
  }
}
