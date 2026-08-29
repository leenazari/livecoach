import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PublicVoiceNotePlayer from "@/components/PublicVoiceNotePlayer";
import { supabaseService } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "A personal voice reply",
  description: "A private voice reply shared through LiveCoach CRM.",
  robots: { index: false, follow: false, nocache: true },
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function NextMoveVoiceNotePage({
  params,
}: {
  params: { token: string };
}) {
  if (!UUID.test(params.token)) notFound();
  const { data: draft, error } = await supabaseService
    .from("email_assistant_drafts")
    .select(
      "owner_id,voice_script,voice_status,voice_audio_path,voice_estimated_seconds,booking_url"
    )
    .eq("voice_public_token", params.token)
    .eq("voice_status", "ready")
    .maybeSingle();
  if (error || !draft?.voice_audio_path) notFound();

  const { data: profile } = await supabaseService
    .from("profiles")
    .select("display_name")
    .eq("user_id", draft.owner_id)
    .maybeSingle();
  const senderName = String(profile?.display_name || "the sender").trim();
  const firstName = senderName.split(/\s+/)[0] || "them";

  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[720px] items-center px-4 py-10 sm:px-6">
      <article className="w-full rounded-3xl border border-amber/45 bg-panel/90 p-6 shadow-2xl sm:p-10">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-amber">
          Personal voice reply
        </p>
        <h1 className="mt-3 font-display text-3xl text-bone">
          A short message from {senderName}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Created specifically for this conversation and approved by {senderName}. It lasts about {draft.voice_estimated_seconds || 50} seconds.
        </p>
        <PublicVoiceNotePlayer
          token={params.token}
          senderName={senderName}
          kind="next-move"
        />
        {draft.voice_script ? (
          <details className="mt-6 rounded-xl border border-edge bg-ink/35 p-4">
            <summary className="cursor-pointer font-mono text-[0.62rem] uppercase tracking-wider text-sage">
              Read the message
            </summary>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-bone/85">
              {draft.voice_script}
            </p>
          </details>
        ) : null}
        {draft.booking_url ? (
          <a
            href={draft.booking_url}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-amber px-6 font-mono text-xs font-semibold uppercase tracking-wider text-ink"
          >
            Book a meeting with {firstName}
          </a>
        ) : null}
        <p className="mt-6 text-xs text-muted">
          This AI-assisted voice message was reviewed and approved by {senderName}. Shared securely through LiveCoach CRM.
        </p>
      </article>
    </main>
  );
}
