import "server-only";

import { supabaseService } from "@/lib/supabase";

export const MEET_SESSION_ID = /^lc-[a-z0-9-]{6,80}$/;

export function validMeetSessionId(value: unknown): value is string {
  return typeof value === "string" && MEET_SESSION_ID.test(value);
}

const MEETING_HOSTS = [
  "meet.google.com",
  "teams.microsoft.com",
  "teams.live.com",
  "zoom.us",
  "zoom.com",
  "webex.com",
  "whereby.com",
  "meet.jit.si",
  "chime.aws",
  "around.co",
  "around.com",
  "gotomeeting.com",
  "gotomeet.me",
];

export function validMeetingUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return MEETING_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`)
    );
  } catch {
    return false;
  }
}

export function deriveTranscriberName(displayName: string | null | undefined) {
  const firstName = String(displayName || "")
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^\p{L}\p{N}'-]/gu, "")
    .slice(0, 40);
  if (!firstName) return "LiveCoach Notetaker";
  const possessive = /s$/i.test(firstName) ? `${firstName}'` : `${firstName}'s`;
  return `${possessive} LiveCoach Notetaker`.slice(0, 80);
}

function transcriberAliases(
  stored: unknown,
  displayName: string | null | undefined
) {
  const aliases = new Map<string, string>();
  const add = (value: unknown) => {
    const clean = String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!clean) return;
    aliases.set(clean.toLowerCase(), clean);
  };

  if (Array.isArray(stored)) stored.forEach(add);
  add(displayName);
  const words = String(displayName || "").trim().split(/\s+/).filter(Boolean);
  if (words.length) add(words[0]);
  if (words.length > 1) add(words.map((word) => word[0]).join(" "));
  return Array.from(aliases.values()).slice(0, 12);
}

export type TranscriberIdentity = {
  botName: string;
  coachHints: string[];
  languageCode: string;
};

export async function getTranscriberIdentity(
  userId: string
): Promise<TranscriberIdentity> {
  const { data, error } = await supabaseService
    .from("profiles")
    .select(
      "display_name,transcriber_name,transcriber_aliases,transcriber_language"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;

  const displayName = data?.display_name || null;
  const botName =
    String(data?.transcriber_name || "").trim().slice(0, 80) ||
    deriveTranscriberName(displayName);
  const coachHints = transcriberAliases(
    data?.transcriber_aliases,
    displayName
  );
  const languageCode =
    typeof data?.transcriber_language === "string" &&
    /^[a-z]{2}(-[A-Z]{2})?$/.test(data.transcriber_language)
      ? data.transcriber_language
      : "en";

  if (
    data &&
    (!data.transcriber_name ||
      !Array.isArray(data.transcriber_aliases) ||
      data.transcriber_aliases.length === 0)
  ) {
    const { error: updateError } = await supabaseService
      .from("profiles")
      .update({
        transcriber_name: botName,
        transcriber_aliases: coachHints,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (updateError) throw updateError;
  }

  return { botName, coachHints, languageCode };
}

export function workerWebSocketUrl() {
  const raw =
    process.env.MEET_WORKER_URL ||
    "https://livecoach-meet-worker-production.up.railway.app";
  const url = new URL(raw);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}
