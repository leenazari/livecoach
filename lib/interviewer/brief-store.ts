import "server-only";

import { briefPrompt, fallbackBrief, parseBrief, talkShareLead, type BriefFacts, type CallBrief } from "@/lib/interviewer/brief";
import { supabaseService } from "@/lib/supabase";

const memory = new Map<string, CallBrief>();

function missingTable(error: { message?: string } | null): boolean {
  return Boolean(error && /does not exist|schema cache|could not find the table/i.test(error.message || ""));
}

async function factsFor(sessionId: string): Promise<{ facts: BriefFacts; workspaceId: string; campaignId: string } | null> {
  const { data: session, error } = await supabaseService
    .from("interviewer_sessions")
    .select("id, workspace_id, campaign_id, invite_id, connected_at, ended_at, disposition, reason_code, timing_raw_quote, calendar_scheduled_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !session) return null;
  const [{ data: invite }, { data: lines }, slides] = await Promise.all([
    supabaseService.from("interviewer_invites").select("prospect_name, prospect_email").eq("id", session.invite_id).maybeSingle(),
    supabaseService.from("interviewer_utterances").select("speaker, text, ts").eq("session_id", sessionId).order("ts", { ascending: true }).limit(400),
    supabaseService.from("interviewer_slide_shows").select("slide_number, shown_at").eq("session_id", sessionId).order("shown_at", { ascending: true }),
  ]);
  const utterances = (lines || []) as Array<{ speaker: string; text: string }>;
  let transcript = utterances.map((line) => `${line.speaker === "lead" ? "Lead" : "Agent"}: ${line.text}`).join("\n");
  if (transcript.length > 12000) transcript = transcript.slice(0, 12000);
  const slideLabels = slides.error ? [] : (slides.data || []).map((slide) => `Slide ${slide.slide_number}`);
  return {
    workspaceId: String(session.workspace_id),
    campaignId: String(session.campaign_id),
    facts: {
      name: String(invite?.prospect_name || "Guest"),
      email: invite?.prospect_email ? String(invite.prospect_email) : null,
      disposition: session.disposition ? String(session.disposition) : null,
      reason: session.reason_code ? String(session.reason_code) : null,
      timing: session.timing_raw_quote ? String(session.timing_raw_quote) : null,
      connectedAt: session.connected_at ? String(session.connected_at) : null,
      endedAt: session.ended_at ? String(session.ended_at) : null,
      scheduledAt: session.calendar_scheduled_at ? String(session.calendar_scheduled_at) : null,
      talkShareLead: talkShareLead(utterances),
      slides: slideLabels,
      transcript,
    },
  };
}

async function modelBrief(facts: BriefFacts): Promise<CallBrief | null> {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key || !facts.transcript) return null;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return only JSON for an internal sales brief. Never invent facts." },
        { role: "user", content: briefPrompt(facts) },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || "{}";
  try {
    return parseBrief(JSON.parse(content), facts);
  } catch {
    return null;
  }
}

export async function loadOrCreateBrief(sessionId: string): Promise<CallBrief | null> {
  const cached = memory.get(sessionId);
  if (cached) return cached;
  const stored = await supabaseService.from("interviewer_call_briefs").select("brief").eq("session_id", sessionId).maybeSingle();
  if (!stored.error && stored.data?.brief) {
    const brief = stored.data.brief as CallBrief;
    memory.set(sessionId, brief);
    return brief;
  }
  const loaded = await factsFor(sessionId);
  if (!loaded) return null;
  const brief = (await modelBrief(loaded.facts).catch(() => null)) || fallbackBrief(loaded.facts);
  memory.set(sessionId, brief);
  const saved = await supabaseService.from("interviewer_call_briefs").upsert({
    session_id: sessionId,
    workspace_id: loaded.workspaceId,
    campaign_id: loaded.campaignId,
    brief,
    source: brief.source,
  });
  if (saved.error && !missingTable(saved.error)) {
    console.error("interviewa brief was not stored");
  }
  return brief;
}
