import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicVoiceNotePlayer from "@/components/PublicVoiceNotePlayer";
import ReturnToInboxButton from "@/components/ReturnToInboxButton";
import { supabaseService } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "A personal voice message",
  description: "A private outreach voice message shared through LiveCoach CRM.",
  robots: { index: false, follow: false, nocache: true },
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function VoiceNotePage({
  params,
}: {
  params: { token: string };
}) {
  if (!UUID.test(params.token)) notFound();
  const { data: message, error } = await supabaseService
    .from("outreach_messages")
    .select(
      "id,workspace_id,sender_user_id,from_email,voice_script,voice_status,voice_audio_path,voice_estimated_seconds"
    )
    .eq("voice_public_token", params.token)
    .eq("voice_status", "ready")
    .maybeSingle();
  if (error || !message?.voice_audio_path) notFound();

  const { data: profile } = await supabaseService
    .from("profiles")
    .select("display_name,outreach_sender_name")
    .eq("user_id", message.sender_user_id)
    .maybeSingle();
  const senderName = String(
    profile?.outreach_sender_name ||
      profile?.display_name ||
      message.from_email?.split("@")[0] ||
      "the sender"
  ).trim();

  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[720px] items-center px-4 py-10 sm:px-6">
      <article className="w-full rounded-3xl border border-amber/45 bg-panel/90 p-6 shadow-2xl sm:p-10">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-amber">
          Personal voice note
        </p>
        <h1 className="mt-3 font-display text-3xl text-bone">
          A short message from {senderName}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Recorded specifically for this conversation. It lasts about {message.voice_estimated_seconds || 50} seconds.
        </p>
        <PublicVoiceNotePlayer token={params.token} senderName={senderName} />
        {message.voice_script ? (
          <details className="mt-6 rounded-xl border border-edge bg-ink/35 p-4">
            <summary className="cursor-pointer font-mono text-[0.62rem] uppercase tracking-wider text-sage">
              Read the message
            </summary>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-bone/85">
              {message.voice_script}
            </p>
          </details>
        ) : null}
        <ReturnToInboxButton
          senderFirstName={senderName.split(/\s+/)[0] || "the sender"}
        />
        <p className="mt-6 text-xs text-muted">
          Shared securely through LiveCoach CRM.
        </p>
      </article>
    </main>
  );
}
