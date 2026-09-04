import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { getRequestScope } from "@/lib/request-scope";

export type TranscriptCallCandidate = {
  summaryId?: string | null;
  sessionId?: string | null;
  upcomingId?: string | null;
  companyId?: string | null;
  workstreamId?: string | null;
  candidate?: string | null;
  role?: string | null;
  title?: string | null;
  companyName?: string | null;
  occurredAt?: string | null;
  scheduledAt?: string | null;
  attendees?: any[];
};

const TRANSCRIPT_REQUEST =
  /\b(transcript|transcription|recording|what\s+(?:did|does)\s+.+?\s+say|what\s+was\s+(?:said|discussed)|what\s+.+?\s+said|read\s+(?:me\s+)?(?:the\s+)?(?:call|conversation)|(?:search|check|look\s+through)\s+(?:in\s+)?(?:the\s+)?(?:call|conversation|transcript|transcription)|conversation\s+(?:from|in|on)\s+(?:the\s+)?call)\b/i;

const MATCH_STOP = new Set([
  "about", "after", "again", "before", "call", "called", "conversation",
  "discussed", "does", "from", "have", "into", "meeting", "recording",
  "last", "latest", "most", "previous", "read", "recent", "said", "say",
  "should", "that", "their", "them", "there", "they", "this", "today",
  "tomorrow", "transcript", "transcription", "what", "when", "where",
  "which", "with", "yesterday", "your",
]);

const EXCERPT_STOP = new Set([
  ...MATCH_STOP,
  "and", "are", "but", "check", "could", "find", "for", "give", "had",
  "has", "her", "him", "his", "its", "look", "not", "our", "out",
  "please", "read", "search", "she", "show", "tell", "the", "through",
  "was", "were", "you",
  "minutes", "minute", "hour", "hours",
]);

const normal = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9@.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (value: unknown, stop: Set<string>) =>
  normal(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !stop.has(token));

const londonDateKey = (value: string | Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);

const shiftDateKey = (dateKey: string, days: number) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
};

const callClock = (value: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return { hour: parts.hour, minute: parts.minute };
};

const requestedClock = (message: string) => {
  const value = message.toLowerCase();
  const withMinutes = value.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/);
  const hourOnly = value.match(/\b(\d{1,2})\s*(am|pm)\b/);
  const match = withMinutes || hourOnly;
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = withMinutes ? Number(match[2]) : 0;
  const suffix = withMinutes ? match[3] : match[2];
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return { hour, minute, twelveHour: !suffix };
};

const requestedDateKey = (message: string, now: Date) => {
  const today = londonDateKey(now);
  if (/\byesterday\b/i.test(message)) return shiftDateKey(today, -1);
  if (/\btomorrow\b/i.test(message)) return shiftDateKey(today, 1);
  if (/\btoday\b/i.test(message)) return today;

  const monthNames =
    "january|february|march|april|may|june|july|august|september|october|november|december";
  const match = message.toLowerCase().match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})(?:\\s+(\\d{4}))?\\b`)
  );
  if (!match) return "";
  const month = monthNames.split("|").indexOf(match[2]);
  const year = match[3] ? Number(match[3]) : now.getFullYear();
  return new Date(Date.UTC(year, month, Number(match[1])))
    .toISOString()
    .slice(0, 10);
};

const occurredAt = (call: TranscriptCallCandidate) =>
  call.scheduledAt || call.occurredAt || "";

export function callTranscriptRequested(message: string): boolean {
  return TRANSCRIPT_REQUEST.test(String(message || ""));
}

export function scoreTranscriptCallCandidate(
  call: TranscriptCallCandidate,
  message: string,
  options: {
    now?: Date;
    screenCallId?: string | null;
    focusCompanyId?: string | null;
  } = {}
): number {
  const now = options.now || new Date();
  if (options.screenCallId && call.summaryId === options.screenCallId) return 200;

  const needle = normal(message);
  const attendeeText = (Array.isArray(call.attendees) ? call.attendees : [])
    .map(
      (attendee: any) =>
        `${attendee?.displayName || attendee?.name || ""} ${attendee?.email || ""}`
    )
    .join(" ");
  const fields = [
    call.candidate,
    call.title,
    call.companyName,
    call.role,
    attendeeText,
  ];
  const haystack = normal(fields.join(" "));
  const callTokens = new Set(tokens(haystack, MATCH_STOP));
  const messageTokens = tokens(needle, MATCH_STOP);
  let score = 0;

  for (const token of messageTokens) {
    if (callTokens.has(token)) score += token.length >= 5 ? 7 : 5;
  }

  for (const exact of [call.candidate, call.title, call.companyName]) {
    const phrase = normal(exact);
    if (phrase.length >= 4 && ` ${needle} `.includes(` ${phrase} `)) score += 14;
  }

  const askedDate = requestedDateKey(message, now);
  const when = occurredAt(call);
  if (askedDate && when)
    score += londonDateKey(when) === askedDate ? 24 : -10;

  const askedTime = requestedClock(message);
  if (askedTime && when) {
    const actual = callClock(when);
    const hourMatches = askedTime.twelveHour
      ? actual.hour % 12 === askedTime.hour % 12
      : actual.hour === askedTime.hour;
    score += hourMatches && actual.minute === askedTime.minute ? 20 : -7;
  }

  if (options.focusCompanyId && call.companyId === options.focusCompanyId)
    score += 3;
  return score;
}

type TranscriptExcerpt = {
  text: string;
  partial: boolean;
  matched: boolean;
};

const splitTranscript = (transcript: string): string[] => {
  const rows = transcript
    .split(/\n+/)
    .map((row) => row.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const row of rows.length ? rows : [transcript]) {
    if (row.length <= 1200) {
      chunks.push(row);
      continue;
    }
    for (let start = 0; start < row.length; start += 1000)
      chunks.push(row.slice(start, start + 1100).trim());
  }
  return chunks;
};

export function selectTranscriptExcerpt(
  transcript: string,
  message: string,
  maxChars = 14_000
): TranscriptExcerpt {
  const clean = String(transcript || "").trim();
  if (!clean) return { text: "", partial: false, matched: false };
  if (clean.length <= maxChars)
    return { text: clean, partial: false, matched: true };

  const rows = splitTranscript(clean);
  const queryTokens = tokens(message, EXCERPT_STOP);
  const scored = rows.map((row, index) => {
    const rowText = normal(row);
    let score = 0;
    for (const token of queryTokens) {
      if (rowText.includes(token)) score += token.length >= 5 ? 5 : 3;
    }
    return { index, score };
  });
  const hits = scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = new Set<number>();
  if (hits.length) {
    for (const hit of hits) {
      for (let index = Math.max(0, hit.index - 1); index <= Math.min(rows.length - 1, hit.index + 1); index++)
        selected.add(index);
      const size = [...selected].reduce((sum, index) => sum + rows[index].length + 1, 0);
      if (size >= maxChars) break;
    }
  } else {
    // A broad request such as "read yesterday's call" has no topic keyword.
    // Sample the beginning, middle and end rather than silently presenting only
    // the opening as if it represented the whole conversation.
    const thirds = [0, Math.floor(rows.length / 2), Math.max(0, rows.length - 1)];
    for (const anchor of thirds) {
      for (let index = Math.max(0, anchor - 2); index <= Math.min(rows.length - 1, anchor + 2); index++)
        selected.add(index);
    }
  }

  const ordered = [...selected].sort((a, b) => a - b);
  const output: string[] = [];
  let used = 0;
  let previousIndex = -2;
  for (const index of ordered) {
    const row = rows[index];
    const gap = previousIndex >= 0 && index > previousIndex + 1
      ? "[… omitted transcript section …]"
      : "";
    const added = row.length + 1 + (gap ? gap.length + 1 : 0);
    if (used + added > maxChars) continue;
    if (gap) output.push(gap);
    output.push(row);
    used += added;
    previousIndex = index;
  }
  return {
    text: output.join("\n"),
    partial: output.length < rows.length,
    matched: hits.length > 0,
  };
}

const callLabel = (call: TranscriptCallCandidate) => {
  const when = occurredAt(call)
    ? new Date(occurredAt(call)).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "date unavailable";
  const name = call.title || call.candidate || call.companyName || "Untitled call";
  const company = call.companyName && call.companyName !== name ? `, ${call.companyName}` : "";
  return `${when}, ${name}${company}`;
};

const callIdFromPath = (path: string) => {
  const match = String(path || "").match(/^\/crm\/calls\/([0-9a-f-]{36})/i);
  return match ? match[1] : null;
};

export async function gatherCallTranscriptContext(
  message: string,
  options: {
    screenPath?: string;
    focusCompanyId?: string | null;
    now?: Date;
  } = {}
): Promise<string> {
  if (!callTranscriptRequested(message)) return "";

  const now = options.now || new Date();
  const since = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const screenCallId = callIdFromPath(options.screenPath || "");
  const requestScope = getRequestScope();
  const sharedCaptureBySession = new Map<string, any>();
  if (requestScope) {
    const { data: grants, error: grantError } = await supabaseService
      .from("meet_capture_access")
      .select("capture_id")
      .eq("workspace_id", requestScope.workspaceId)
      .eq("user_id", requestScope.userId)
      .is("revoked_at", null)
      .limit(500);
    if (grantError) throw grantError;
    const captureIds = (grants || []).map((row: any) => row.capture_id);
    if (captureIds.length) {
      const { data: captures, error: captureError } = await supabaseService
        .from("meet_bots")
        .select("id,session_id,owner_id")
        .eq("workspace_id", requestScope.workspaceId)
        .in("id", captureIds);
      if (captureError) throw captureError;
      for (const capture of captures || []) {
        if ((capture as any).session_id)
          sharedCaptureBySession.set((capture as any).session_id, capture);
      }
    }
  }
  let summariesQuery = supabaseAdmin
    .from("interview_summaries")
    .select("id, session_id, candidate, role, company_id, workstream_id, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);
  let sessionsQuery = supabaseAdmin
    .from("interview_sessions")
    .select("session_id, upcoming_id, candidate, role, company_id, workstream_id, created_at, started_at, ended_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);
  if (requestScope && requestScope.role !== "owner") {
    summariesQuery = summariesQuery.eq("owner_id", requestScope.userId);
    sessionsQuery = sessionsQuery.eq("owner_id", requestScope.userId);
  }
  const [summariesRes, sessionsRes] = await Promise.all([
    summariesQuery,
    sessionsQuery,
  ]);
  if (summariesRes.error) throw summariesRes.error;
  if (sessionsRes.error) throw sessionsRes.error;

  const sharedSessionIds = [...sharedCaptureBySession.keys()];
  const [{ data: sharedSummaries }, { data: sharedSessions }] =
    requestScope && sharedSessionIds.length
      ? await Promise.all([
          supabaseService
            .from("interview_summaries")
            .select("id, session_id, candidate, role, company_id, workstream_id, created_at")
            .eq("workspace_id", requestScope.workspaceId)
            .in("session_id", sharedSessionIds),
          supabaseService
            .from("interview_sessions")
            .select("session_id, upcoming_id, candidate, role, company_id, workstream_id, created_at, started_at, ended_at")
            .eq("workspace_id", requestScope.workspaceId)
            .in("session_id", sharedSessionIds),
        ])
      : [{ data: [] as any[] }, { data: [] as any[] }];
  const summaryIds = new Set(
    (summariesRes.data || []).map((row: any) => row.id)
  );
  const summaries = [
    ...(summariesRes.data || []),
    ...(sharedSummaries || []).filter((row: any) => !summaryIds.has(row.id)),
  ];
  const ownSessionIds = new Set(
    (sessionsRes.data || []).map((row: any) => row.session_id)
  );
  const sessions = [
    ...(sessionsRes.data || []),
    ...(sharedSessions || []).filter(
      (row: any) => !ownSessionIds.has(row.session_id)
    ),
  ];

  const sessionById = new Map(
    sessions.map((session: any) => [session.session_id, session])
  );
  const upcomingIds = Array.from(
    new Set(sessions.map((session: any) => session.upcoming_id).filter(Boolean))
  );
  const companyIds = Array.from(
    new Set(
      [...summaries, ...sessions]
        .map((row: any) => row.company_id)
        .filter(Boolean)
    )
  );
  const upcomingQuery = requestScope
    ? supabaseService
        .from("upcoming_calls")
        .select("id, title, scheduled_at, attendees, company_id, workstream_id")
        .eq("workspace_id", requestScope.workspaceId)
        .in("id", upcomingIds)
    : supabaseAdmin
        .from("upcoming_calls")
        .select("id, title, scheduled_at, attendees, company_id, workstream_id")
        .in("id", upcomingIds);
  const companiesQuery = requestScope
    ? supabaseService
        .from("companies")
        .select("id, name")
        .eq("workspace_id", requestScope.workspaceId)
        .in("id", companyIds)
    : supabaseAdmin.from("companies").select("id, name").in("id", companyIds);
  const [upcomingRes, companiesRes] = await Promise.all([
    upcomingIds.length
      ? upcomingQuery
      : Promise.resolve({ data: [] as any[], error: null }),
    companyIds.length
      ? companiesQuery
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (upcomingRes.error) throw upcomingRes.error;
  if (companiesRes.error) throw companiesRes.error;
  const upcomingById = new Map(
    (upcomingRes.data || []).map((call: any) => [call.id, call])
  );
  const companyNameById = new Map(
    (companiesRes.data || []).map((company: any) => [company.id, company.name])
  );

  const candidates: TranscriptCallCandidate[] = [];
  const representedSessions = new Set<string>();
  for (const summary of summaries) {
    const session: any = summary.session_id
      ? sessionById.get(summary.session_id)
      : null;
    const upcoming: any = session?.upcoming_id
      ? upcomingById.get(session.upcoming_id)
      : null;
    if (summary.session_id) representedSessions.add(summary.session_id);
    const companyId = summary.company_id || session?.company_id || upcoming?.company_id || null;
    candidates.push({
      summaryId: summary.id,
      sessionId: summary.session_id || null,
      upcomingId: session?.upcoming_id || null,
      companyId,
      workstreamId: summary.workstream_id || session?.workstream_id || upcoming?.workstream_id || null,
      candidate: summary.candidate || session?.candidate || null,
      role: summary.role || session?.role || null,
      title: upcoming?.title || null,
      companyName: companyId ? companyNameById.get(companyId) || null : null,
      occurredAt: session?.started_at || session?.ended_at || summary.created_at,
      scheduledAt: upcoming?.scheduled_at || null,
      attendees: upcoming?.attendees || [],
    });
  }
  for (const session of sessions) {
    if (!session.session_id || representedSessions.has(session.session_id)) continue;
    const upcoming: any = session.upcoming_id
      ? upcomingById.get(session.upcoming_id)
      : null;
    const companyId = session.company_id || upcoming?.company_id || null;
    candidates.push({
      sessionId: session.session_id,
      upcomingId: session.upcoming_id || null,
      companyId,
      workstreamId: session.workstream_id || upcoming?.workstream_id || null,
      candidate: session.candidate || null,
      role: session.role || null,
      title: upcoming?.title || null,
      companyName: companyId ? companyNameById.get(companyId) || null : null,
      occurredAt: session.started_at || session.ended_at || session.created_at,
      scheduledAt: upcoming?.scheduled_at || null,
      attendees: upcoming?.attendees || [],
    });
  }

  const ranked = candidates
    .map((call) => ({
      call,
      score: scoreTranscriptCallCandidate(call, message, {
        now,
        screenCallId,
        focusCompanyId: options.focusCompanyId || null,
      }),
    }))
    .sort((a, b) =>
      b.score - a.score ||
      new Date(occurredAt(b.call) || 0).getTime() -
        new Date(occurredAt(a.call) || 0).getTime()
    );
  const best = ranked[0];
  if (!best || best.score < 5) {
    return [
      "ON-DEMAND CALL TRANSCRIPT LOOKUP",
      "No precise call match was found. Do not answer from a different call or a generic client summary.",
      "Tell the user the transcript could not be located safely and ask for the person's name plus the call date or time.",
    ].join("\n");
  }
  const wantsLatest = /\b(last|latest|most recent|previous)\b/i.test(message);
  const closeMatches = ranked.filter(
    (row) =>
      row !== best &&
      row.score >= best.score - 3 &&
      row.call.sessionId !== best.call.sessionId
  );
  if (best.score < 100 && !wantsLatest && closeMatches.length) {
    return [
      "ON-DEMAND CALL TRANSCRIPT LOOKUP",
      "More than one call matches closely. Do not combine their transcripts or guess which one the user meant.",
      "Ask the user to choose one of these calls:",
      ...[best, ...closeMatches]
        .slice(0, 4)
        .map((row) => `- ${callLabel(row.call)}`),
    ].join("\n");
  }

  let transcript = "";
  if (best.call.sessionId) {
    const sharedCapture = sharedCaptureBySession.get(best.call.sessionId);
    let transcriptQuery = sharedCapture && requestScope
      ? supabaseService
          .from("interview_sessions")
          .select("transcript")
          .eq("workspace_id", requestScope.workspaceId)
          .eq("owner_id", sharedCapture.owner_id)
          .eq("session_id", best.call.sessionId)
          .order("created_at", { ascending: false })
          .limit(1)
      : supabaseAdmin
          .from("interview_sessions")
          .select("transcript")
          .eq("session_id", best.call.sessionId)
          .order("created_at", { ascending: false })
          .limit(1);
    if (!sharedCapture && requestScope && requestScope.role !== "owner")
      transcriptQuery = transcriptQuery.eq("owner_id", requestScope.userId);
    const { data, error } = await transcriptQuery.maybeSingle();
    if (error) throw error;
    transcript = typeof data?.transcript === "string" ? data.transcript.trim() : "";
  }
  let manualNotes = "";
  if (!transcript && best.call.summaryId) {
    const sharedCapture = best.call.sessionId
      ? sharedCaptureBySession.get(best.call.sessionId)
      : null;
    let notesQuery = sharedCapture && requestScope
      ? supabaseService
          .from("interview_summaries")
          .select("summary")
          .eq("workspace_id", requestScope.workspaceId)
          .eq("id", best.call.summaryId)
      : supabaseAdmin
          .from("interview_summaries")
          .select("summary")
          .eq("id", best.call.summaryId);
    if (!sharedCapture && requestScope && requestScope.role !== "owner")
      notesQuery = notesQuery.eq("owner_id", requestScope.userId);
    const { data, error } = await notesQuery.maybeSingle();
    if (error) throw error;
    const notes = data?.summary && typeof data.summary === "object"
      ? (data.summary as any).userNotes
      : "";
    manualNotes = typeof notes === "string" ? notes.trim() : "";
  }

  if (!transcript) {
    return [
      "ON-DEMAND CALL TRANSCRIPT LOOKUP",
      `Matched call: ${callLabel(best.call)}`,
      "Raw transcript: unavailable. Do not substitute text from another call or claim a transcript was checked.",
      manualNotes
        ? `A manual user-written recap is available instead:\n${manualNotes.slice(0, 8_000)}`
        : "No manual recap is stored either. Answer only that the raw transcript is unavailable.",
    ].join("\n");
  }

  const excerpt = selectTranscriptExcerpt(transcript, message);
  return [
    "ON-DEMAND CALL TRANSCRIPT SOURCE (authoritative for this question)",
    `Matched call: ${callLabel(best.call)}`,
    `Canonical source: interview_sessions.transcript for session ${best.call.sessionId}`,
    excerpt.partial
      ? excerpt.matched
        ? "The transcript is long, so only the most relevant speaker turns and their immediate context were loaded."
        : "The transcript is long and the request is broad, so bounded samples from the beginning, middle and end were loaded. Ask for a narrower topic if the answer is not present."
      : "The full stored transcript was loaded.",
    "Never use another call's summary or transcript to fill a gap.",
    "TRANSCRIPT CONTENT",
    excerpt.text,
  ].join("\n");
}
