import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  anthropic,
  CLAUDE_MODEL_LIVE,
  CLAUDE_MODEL_BRAIN,
} from "@/lib/anthropic";
import {
  gatherClientContext,
  gatherGlobalContext,
  findCompaniesNamedIn,
} from "@/lib/crm-context";
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
    .select("id, title, scheduled_at, intent")
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
  if (type === "add_intent") {
    // Append to the call's existing focus rather than overwriting it. If the
    // note is already there (the user is just re-confirming, or it was added
    // before) leave it untouched, so confirming can never duplicate the text.
    const cur = typeof call.intent === "string" ? call.intent.trim() : "";
    const note = String(x.note || "").trim();
    const already = !!note && cur.toLowerCase().includes(note.toLowerCase());
    const next = already ? cur : cur ? `${cur} ${note}` : note;
    return { endpoint: `/api/crm/upcoming/${call.id}`, method: "PATCH", body: { intent: next } };
  }
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
    : type === "add_intent"
    ? "add to the focus for"
    : type === "link_call"
    ? "link"
    : "remove";
}

async function resolveActions(items: any[]): Promise<any[]> {
  const out: any[] = [];
  const callTypes = ["set_meeting_link", "set_intent", "add_intent", "link_call", "cancel_call"];
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
      } else if (it.type === "add_intent") {
        x.note =
          typeof it.note === "string"
            ? it.note.trim()
            : typeof it.intent === "string"
            ? it.intent.trim()
            : "";
        if (!x.note) continue;
        detail = `: ${x.note}`;
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

    if (it.type === "create_client") {
      const name = (typeof it.name === "string" ? it.name : it.client || "")
        .toString()
        .trim();
      if (!name) continue;
      // Don't duplicate someone already in the pipeline.
      const existing = await findCompany(name);
      if (existing) continue;
      const brief =
        typeof it.brief === "string"
          ? it.brief.trim()
          : typeof it.background === "string"
          ? it.background.trim()
          : "";
      out.push({
        key,
        type: it.type,
        label: `Create a profile for "${name}"`,
        endpoint: `/api/crm/companies`,
        method: "POST",
        body: brief ? { name, notes: brief } : { name },
      });
      continue;
    }

    if (it.type === "pull_emails") {
      // Pull the recent Gmail thread with a person and build / refresh their
      // client from it. The client fires this endpoint on confirm; the route
      // reads Gmail server-side and creates or updates the company + contact.
      const person = (
        typeof it.person === "string"
          ? it.person
          : typeof it.name === "string"
          ? it.name
          : typeof it.client === "string"
          ? it.client
          : ""
      ).trim();
      const em = typeof it.email === "string" ? it.email.trim() : "";
      if (!person && !em) continue;
      out.push({
        key,
        type: it.type,
        label: `Pull ${person || em}'s emails and build their client profile`,
        endpoint: `/api/crm/email-pull`,
        method: "POST",
        body: em ? { email: em } : { name: person },
      });
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

    if (it.type === "correct") {
      const client = (typeof it.client === "string" ? it.client : "").trim();
      const correction = (
        typeof it.correction === "string" ? it.correction : ""
      ).trim();
      if (!correction) continue;
      const company = await findCompany(client);
      if (!company) continue;
      out.push({
        key,
        type: it.type,
        label: `Correct ${company.name}'s record: ${correction}`,
        endpoint: `/api/crm/companies/${company.id}/correct`,
        method: "POST",
        body: { correction },
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
    // Lightweight timing so we can SEE where a reply spends its time (context
    // gather vs model) and whether prompt caching is hitting, before optimising
    // further. Logged once per reply as "assistant-timing {...}".
    const reqStart = Date.now();
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
      // DETAIL ON DEMAND. Pull FULL context for the client the user is on
      // (focus) and for any client they NAME in the message, but only a one-line
      // digest for everyone else. Keeps the prompt small as the book of clients
      // grows, without losing depth on whoever the question is actually about.
      const named = await findCompaniesNamedIn(message);
      const detailIds: string[] = [];
      if (focus) detailIds.push(focus);
      for (const n of named) {
        if (!detailIds.includes(n.id) && detailIds.length < 3)
          detailIds.push(n.id);
      }
      const [digest, ...details] = await Promise.all([
        gatherGlobalContext(),
        ...detailIds.map((id) => gatherClientContext(id)),
      ]);
      const detailBlocks = (details as (string | null)[]).filter(
        (d): d is string => !!d && d.trim().length > 0
      );
      if (!detailBlocks.length) return digest || null;
      const label = focus
        ? "FOCUSED / NAMED CLIENTS - full detail. Lead here when the question is about them:"
        : "NAMED CLIENTS - full detail on the client(s) the user mentioned:";
      return `${label}\n\n${detailBlocks.join(
        "\n\n----------\n\n"
      )}\n\n==========\n\nTHE WIDER PIPELINE - one line per client (full detail comes up when you name a client):\n\n${digest}`;
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
    const ctxMs = Date.now() - reqStart; // time to gather all grounding context
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

CONTINUE, DON'T RESTART: if the user says "repeat", "continue", "carry on", "go on", "finish that" or "you cut off", do NOT begin your previous answer again from the top. Pick up exactly where the last reply ended and give only the part that was missing. A brief "Picking up where I left off," then the rest is fine. Never re-read text they already heard.

ANSWER THE NEW QUESTION, NEVER RECAP YOUR LAST ANSWER FIRST. This is critical and gets noticed when you fail it. Open every reply by directly addressing what the user JUST asked. Do NOT lead with a restatement or summary of your previous answer or of what you just did (no "I've added that...", "As I said...", "The most important thing is still..."). They already read your last reply, repeating it back is exactly what frustrates them. If the new message is a fresh question, drop the previous topic completely and answer the new one in your first sentence. If they ask a follow-up (for example "what would the pitch be"), ANSWER that exact thing, do not restate your earlier answer instead of answering. One short transition word is the most you may spend before the substance.

EXPLAIN THE WHY. When the user DOES ask for advice or a next step, work the reasoning into your sentences so they learn the thinking, not just the instruction. Say what in the history makes it the right move. Do this in plain prose, not under a "Why:" label.

BE CONCRETE: real steps, who to contact, roughly when, what to say. When you suggest an order, explain it in a sentence.

HOW TO WRITE (this matters a lot - the user finds over-formatted answers robotic):
- Write the way a sharp colleague talks. Short paragraphs of plain sentences. Usually two to four short paragraphs is plenty.
- Do NOT use markdown formatting. No "#" or "##" headings. No "**bold**". No markdown tables.
- Avoid bullet-point and numbered lists unless the user explicitly asks for a list. Prefer flowing sentences. If you genuinely must list a few items, keep it to plain short lines with no bold.
- Never write words in all-caps for emphasis (no "TODAY", "NOW"). Don't shout.
- Never use em-dashes or semicolons. Use commas and full stops instead.
- Lead with the single most useful thing. Cut filler and preamble. Don't pad to sound thorough.

VOICE INPUT AND NAMES: the user usually talks to you by voice, so the transcript can mishear words, especially names. When a word is close to a person, client or company name that appears in the context (for example "Elaine", "Elon" or "a lane" for "Alain", "Joy deep" for "Joydeep", "Manny" vs "Danny"), treat it as that known name and use the correct spelling in your reply and in anything you draft. When the context makes the intended name obvious, just use it - do not stop to ask which name they meant.

DRAFTS - ONLY WHEN ASKED (this keeps replies fast): do NOT write a full email, message or document unless the user EXPLICITLY asks you to draft, write, or send one. For a normal question, answer concisely and, if a draft would help, OFFER it in a single line ("want me to draft that email?") rather than writing it. Writing a long draft nobody asked for is slow and wasteful. When they DO ask you to draft something, put ONLY that sendable text between these exact marker lines:
---DRAFT---
<the sendable text only - for an email include a "Subject:" line then the body>
---END DRAFT---
Keep your commentary and reasoning OUTSIDE the markers. The text inside the markers can be plain and clean since it is what gets sent.

TO-DOS: when the user asks you to arrange, remember, chase, follow up, add, draft, prep, or otherwise CREATE actions to do later, capture each as a to-do. In ADDITION to your normal prose reply, put ONLY a JSON array between these exact markers:
---TASKS---
[{"text":"short imperative to-do","action":"email|call|task","dueAt":"YYYY-MM-DD","pinned":true}]
---END TASKS---
Use "action" = "email" for anything to write or send, "call" to prep or schedule a call, "task" for anything else. Set "dueAt" to the deadline DATE when the user gives one, working out the real date from today's date in the context (e.g. "by Friday" becomes that Friday's YYYY-MM-DD, "by end of month" the last day of this month). Set "pinned" to true when the user says to keep it at the top, make it top priority, do it first, or that it is urgent. OMIT dueAt and pinned when the user did not give a deadline or priority. Only create to-dos the user actually wants tracked, and do not repeat ones already outstanding in the context. They appear on the user's to-do list with the action attached. Keep these markers out of your prose, and still answer naturally.

CALENDAR: the user's upcoming calls, synced from their calendar, are in the context below in the calls list, each with its join link when there is one. Answer "what's on my calendar" / "what's next" from that, and give the join link when asked. You cannot edit their Google calendar itself, but you CAN, with their confirmation, attach or change the meeting link, set or clear the intent, or link a call to a client on the in-app call record (see ACTIONS). If they tell you a call moved or was cancelled, note it or add a to-do, and remind them the synced view refreshes from their calendar.

ACTIONS YOU CAN TAKE (never claim you already did them - the Confirm button is what does the work): when the user explicitly asks you to attach or change a meeting link on a call, set or clear a call's intent, ADD a note to a call's focus (add_intent), link a call to a client, cancel/remove a call that is no longer happening (it was cancelled or already happened separately) and note why, dismiss a draft or a to-do, or CREATE a profile for someone new (create_client), or CORRECT a fact the records currently have wrong about a client (correct), propose it. ALSO watch for the user stating a durable PREFERENCE, habit, standard practice, rule, or lasting fact about how they work or their business (for example "I wait 48 hours before chasing a follow-up", "I never call before 10am", "always cc Mark on proposals", "my standard pilot is two weeks"). When they do, offer to REMEMBER it with a "remember" action so it sticks for future plans, cues and chats - acknowledge it in your prose AND propose saving it; never save silently. In ADDITION to a short prose reply, put ONLY a JSON array between these exact markers:
---ACTIONS---
[{"type":"set_meeting_link","call":"<call title or person from the context>","url":"<link>"},{"type":"set_intent","call":"<call title>","intent":"<intent text, empty to clear>"},{"type":"add_intent","call":"<call title>","note":"<the focus note to add to that call, kept alongside what is already there>"},{"type":"link_call","call":"<call title>","client":"<client name>"},{"type":"cancel_call","call":"<call title>","reason":"<why it is not happening, optional>"},{"type":"dismiss","kind":"draft","item":"<the draft subject>"},{"type":"dismiss","kind":"task","item":"<the to-do text>"},{"type":"create_client","name":"<person or company name>","brief":"<what you know about them so far, one or two sentences>"},{"type":"remember","note":"<the durable preference, habit, standard practice or fact to save, in one clear line>"},{"type":"correct","client":"<the client this correction is about>","correction":"<the corrected fact in one clear line>"},{"type":"pull_emails","person":"<their name>","email":"<their email if you know it, optional>"}]
---END ACTIONS---
When a call is cancelled or has moved off the calendar, use cancel_call (it removes the call and its prep to-do and records the reason). If there are also leftover to-dos or drafts about that call, propose dismissing those too. If you are not sure which call, client, draft or to-do the user means, ask them to clarify in your prose reply rather than guessing (the system will also offer a pick-list if more than one record matches the name).
Refer to the call, client, draft or to-do by the exact name/title/text shown in the context so it can be matched. Each one is shown to the user with a Confirm button and nothing happens until they tap it, so never say it is done.

NEW PEOPLE: when the user introduces or talks about a person or company who is a contact, prospect, partner or lead and is NOT already in the context, proactively OFFER to create their profile with create_client, capturing what you know in the brief, so future calls and notes track against them. Suggest it early rather than waiting to be asked twice.

PULL EMAILS: you CAN read the user's Gmail thread with a person (through the connected Google account) and build their client from it. When the user asks you to pull, fetch, check or look at someone's email, or to add a client from an email thread, emit a "pull_emails" action with their name (and their email if it is in the context or the message). This reads the recent thread with them, distils it into their client context, and creates or refreshes their profile and contact, ready for prep. Do not say you cannot access email. If Google is not connected or Gmail was not granted, the action will report that back and the user can connect it in Settings. When the user mentions emailing someone new from a company address, offer to pull the thread and set them up.

FIX WRONG RECORDS: when the user corrects a fact about a client (for example the records say someone was ill and they tell you it was actually a colleague, or a name, role, date, stage or detail is wrong), do NOT just acknowledge it in prose and move on. The records do not update themselves from chat. Emit a "correct" action naming the client and the corrected fact, so the stored "what we know", playbook, to-dos and call summary all get fixed. Acknowledge briefly in one line AND emit the action.

PREP NOTES GO INTO THE CALL: when the user says to add something to the plan or focus for a named upcoming call (for example "add to the focus for the Alain call that I should bring up Darren"), use add_intent so it lands in that call's intent window and is in front of them at prep time. Do NOT just make a loose to-do for this, since that is easy to miss.

EXPLICIT ASK = ACT NOW: when the user explicitly asks for one of these (create a profile, add to a plan, remember something, change or cancel a call, dismiss something), propose the action straight away in the SAME reply. Do not ask "want me to?" a second time when they have already told you to do it, and never claim it is already done. Emitting the action IS how you carry out their request. Only the destructive ones (cancel a call, dismiss a draft or to-do) and anything you are unsure about need a careful confirm. If you are not sure which call, client, draft or to-do they mean, ask them to clarify in your prose rather than guessing (the system also offers a pick-list when more than one record matches). Only include the actions the user actually asked for. Keep these markers out of your prose and still reply naturally.

STATUS QUESTIONS ARE NOT ACTIONS: when the user is only asking what you have, what is already planned, or to confirm something is done (for example "have you got everything for Alain", "what's on the plan for that call", "did you add that"), answer in prose from the context and emit NO action. Never re-propose an action you already proposed earlier in the thread, or one whose change is already present in the context, because that makes the user re-confirm something already done, which is confusing. Only emit an action when the user is asking you to make a NEW change right now.

TONE: warm, sharp, brief. Plain English, like a smart colleague who knows the book of business well and respects your time.

SPOKEN SUMMARY: the user often listens to your reply by voice, and hearing the whole thing read out is long winded (especially for a game plan or a list). So ALWAYS also give a SHORT spoken version - one or two sentences that carry the gist and the single most useful point, in a natural talking voice. Put ONLY that between these exact markers:
---SPOKEN---
<one or two spoken sentences. If your written reply ends by asking the user something, repeat that question word for word as the LAST sentence here>
---END SPOKEN---
ALWAYS end the spoken version with your closing question whenever your reply has one. The user is often hands-free, so hearing the question read out is what keeps the conversation going - never drop it. NEVER read out a full draft or email in the spoken version. If you wrote a draft, the spoken version should just say a draft is ready and ASK if they want you to read it out. Keep these markers out of your visible prose. The full written answer still goes in your normal reply.`,
        // Cache the big, stable instruction block so repeat calls skip
        // re-processing it (lower latency + cost). It only changes when the
        // brain knowledge or lessons change.
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
      {
        type: "text",
        text: `${isGlobal ? "PIPELINE CONTEXT" : "CONTEXT"} (everything we know):\n\n${context}`,
        cache_control: { type: "ephemeral", ttl: "1h" },
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
    const model = simple ? CLAUDE_MODEL_LIVE : CLAUDE_MODEL_BRAIN;
    // Long strategic answers were getting cut off mid-sentence at 1300 tokens
    // (and then the SPOKEN block never arrived). Give the smart model real room
    // to finish a full game-plan; keep the fast lookups tight.
    const maxTok = simple ? 900 : 2400;

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
        let firstTokenAt = 0; // when the first word arrived (for TTFT)
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
                if (!firstTokenAt) firstTokenAt = Date.now();
                full += t;
                frame(controller, { type: "delta", text: t });
              }
            }
          }
          let usage: any = null;
          let stopReason: string | null = null;
          try {
            const fm = await aStream.finalMessage();
            usage = fm?.usage;
            stopReason = (fm as any)?.stop_reason ?? null;
            if (!full && Array.isArray(fm?.content)) {
              full = fm.content
                .filter((b: any) => b.type === "text")
                .map((b: any) => b.text)
                .join("");
            }
          } catch {
            /* ignore - we still have `full` from the deltas */
          }
          await logModelUsage("assistant", simple ? "haiku" : "opus", usage);

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
                    dueAt:
                      typeof x.dueAt === "string" &&
                      /^\d{4}-\d{2}-\d{2}/.test(x.dueAt)
                        ? x.dueAt
                        : undefined,
                    pinned: x.pinned === true,
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

          // If we still hit the token ceiling, the prose can end mid-sentence
          // (and the SPOKEN block never arrived). Trim back to the last complete
          // sentence so it never dangles mid-word.
          if (stopReason === "max_tokens" && reply) {
            const cut = reply.match(/^[\s\S]*[.!?]["')\]]?(?=\s|$)/);
            if (cut && cut[0].trim().length > 60) reply = cut[0].trim();
          }

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

          // One timing line per reply (visible in Vercel runtime logs). ctxMs =
          // DB/context gather, ttftMs = time to first word, totalMs = end to end.
          // cacheRead > 0 proves the prompt cache is hitting.
          console.log(
            "assistant-timing " +
              JSON.stringify({
                model: simple ? "haiku" : "opus",
                ctxMs,
                ttftMs: firstTokenAt ? firstTokenAt - reqStart : null,
                totalMs: Date.now() - reqStart,
                stop: stopReason,
                inTok: usage?.input_tokens ?? null,
                outTok: usage?.output_tokens ?? null,
                cacheRead: usage?.cache_read_input_tokens ?? null,
                cacheWrite: usage?.cache_creation_input_tokens ?? null,
              })
          );
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
