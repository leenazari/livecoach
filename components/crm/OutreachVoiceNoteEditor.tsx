"use client";

import { useRef, useState } from "react";

import {
  estimateOutreachVoiceCostGbp,
  OUTREACH_VOICE_HARD_MAX_CHARACTERS,
  OUTREACH_VOICE_HARD_MAX_COST_GBP,
  OUTREACH_VOICE_HARD_MAX_WORDS,
  OUTREACH_VOICE_PREFERRED_MAX_WORDS,
  OUTREACH_VOICE_PREFERRED_MIN_WORDS,
  OUTREACH_VOICE_TARGET_COST_GBP,
  OUTREACH_VOICE_TARGET_WORDS,
} from "@/lib/outreach-voice-policy";

type VoiceMessage = {
  id?: string;
  status?: string;
  voice_script?: string | null;
  voice_status?: string | null;
  voice_public_token?: string | null;
  voice_generated_at?: string | null;
  voice_script_hash?: string | null;
  voice_estimated_seconds?: number | null;
  voice_estimated_cost_gbp?: number | null;
  voice_error?: string | null;
  voice_script_approved_at?: string | null;
  voice_script_approved_by?: string | null;
  voice_script_approved_hash?: string | null;
  strategy?: {
    voiceUrgency?: {
      type?: "verified_trigger" | "natural_next_moment" | string;
      whyNow?: string | null;
      evidence?: string | null;
      includedInScript?: boolean;
    } | null;
  } | null;
};

export default function OutreachVoiceNoteEditor({
  message,
  script,
  disabled,
  generating,
  onScriptChange,
  onGenerate,
}: {
  message: VoiceMessage;
  script: string;
  disabled?: boolean;
  generating?: boolean;
  onScriptChange: (value: string) => void;
  onGenerate: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  const scriptMissing = !script.trim();
  const scriptChanged = script.trim() !== String(message.voice_script || "").trim();
  const ready = message.voice_status === "ready" && !scriptChanged;
  const scriptApproved =
    !scriptChanged &&
    Boolean(message.voice_script_approved_at) &&
    Boolean(message.voice_script_approved_by) &&
    Boolean(message.voice_script_approved_hash);
  const seconds = Math.max(20, Math.min(90, Math.round((words / 135) * 60)));
  const characters = script.length;
  const generatedCostPence = Number(message.voice_estimated_cost_gbp || 0) * 100;
  const estimatedCostPence = generatedCostPence > 0
    ? generatedCostPence
    : estimateOutreachVoiceCostGbp(script) * 100;
  const outsidePreferredRange = words > 0 && (
    words < OUTREACH_VOICE_PREFERRED_MIN_WORDS ||
    words > OUTREACH_VOICE_PREFERRED_MAX_WORDS
  );
  const overTargetCost = estimatedCostPence > OUTREACH_VOICE_TARGET_COST_GBP * 100;
  const whyNow = String(message.strategy?.voiceUrgency?.whyNow || "").trim();
  const whyNowIncluded = Boolean(
    whyNow && script.toLocaleLowerCase("en-GB").includes(whyNow.toLocaleLowerCase("en-GB"))
  );
  const verifiedUrgency = message.strategy?.voiceUrgency?.type === "verified_trigger";
  const beyondSafetyLimit = words > 0 && (
    words > OUTREACH_VOICE_HARD_MAX_WORDS ||
    characters > OUTREACH_VOICE_HARD_MAX_CHARACTERS ||
    estimatedCostPence > OUTREACH_VOICE_HARD_MAX_COST_GBP * 100
  );
  const locked = disabled || ["sending", "sent"].includes(message.status || "");
  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch {
      setPlaying(false);
    }
  };
  return (
    <section className="rounded-xl border border-amber/40 bg-amber/[0.05] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[0.52rem] uppercase tracking-wider text-amber">
            Personal voice note
          </p>
          <p className="mt-1 text-xs leading-5 text-bone/75">
            Optional. Your personalised script appears automatically. Edit it if needed, then generate one audio preview. You can still queue the email without a voice note.
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-1 font-mono text-[0.48rem] uppercase ${
            ready
              ? "border-moss/50 bg-moss/10 text-moss"
              : beyondSafetyLimit
                ? "border-rust/50 bg-rust/10 text-rust"
                : "border-amber/45 bg-amber/10 text-amber"
          }`}
        >
          {ready
              ? `Ready · ${message.voice_estimated_seconds || seconds}s${generatedCostPence > 0 ? ` · est ${generatedCostPence.toFixed(1)}p` : ""}`
            : scriptChanged && message.voice_status === "ready"
              ? "Edited · regenerate"
              : scriptMissing
                ? "Script missing"
              : message.voice_status === "failed"
                ? "Needs retry"
                : generating || message.voice_status === "generating"
                  ? "Creating voice"
                  : "Script ready"}
        </span>
      </div>
      <label className="mt-3 block">
        <span className="sr-only">Personal voice note script</span>
        <textarea
          rows={7}
          value={script}
          onChange={(event) => onScriptChange(event.target.value)}
          disabled={locked}
          className="w-full rounded-lg border border-edge bg-ink/55 px-3 py-2 text-sm leading-6 text-bone outline-none focus:border-amber/60 disabled:opacity-60"
        />
      </label>
      {whyNow ? (
        <div className={`mt-2 rounded-lg border px-3 py-2 ${whyNowIncluded ? "border-moss/35 bg-moss/[0.06]" : "border-amber/45 bg-amber/[0.07]"}`}>
          <p className={`font-mono text-[0.52rem] uppercase tracking-wider ${whyNowIncluded ? "text-moss" : "text-amber"}`}>
            Why act now · {verifiedUrgency ? "verified current trigger" : "natural next moment"}
          </p>
          <p className="mt-1 text-xs leading-5 text-bone/80">{whyNow}</p>
          {!whyNowIncluded ? (
            <p className="mt-1 text-xs leading-5 text-amber">Keep this gentle urgency in the script or prepare the draft again.</p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs ${beyondSafetyLimit ? "text-rust" : outsidePreferredRange || overTargetCost ? "text-amber" : "text-muted"}`}>
          {words} words · about {seconds} seconds · estimated {estimatedCostPence.toFixed(1)}p. Aim for about {OUTREACH_VOICE_TARGET_WORDS} words, usually {OUTREACH_VOICE_PREFERRED_MIN_WORDS} to {OUTREACH_VOICE_PREFERRED_MAX_WORDS}.
        </p>
        {!locked ? (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              type="button"
              onClick={onGenerate}
              disabled={
                generating ||
                Boolean(whyNow && !whyNowIncluded) ||
                beyondSafetyLimit ||
                !script.trim()
              }
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-amber/55 bg-amber/10 px-3 py-2 font-mono text-[0.54rem] uppercase tracking-wider text-amber disabled:cursor-not-allowed disabled:opacity-40"
            >
              {generating
                ? "Creating voice…"
                : ready
                  ? "Refresh steady delivery"
                  : scriptMissing
                    ? "Create script first"
                    : `Generate voice · est ${estimatedCostPence.toFixed(1)}p`}
            </button>
          </div>
        ) : null}
      </div>
      {beyondSafetyLimit ? (
        <p className="mt-2 text-xs leading-5 text-rust">
          This is beyond the 7.5p safety limit. Shorten it without cutting the final sentence.
        </p>
      ) : outsidePreferredRange || overTargetCost ? (
        <p className="mt-2 text-xs leading-5 text-amber">
          This is outside the normal 45 second target, but it can still be approved. Complete sentences and useful personalisation take priority over the five pence benchmark.
        </p>
      ) : null}
      <p className="mt-2 text-xs leading-5 text-moss" role="status" aria-live="polite">
        {ready
          ? "This approved voice note is ready to preview. Refresh reuses it unless the script or delivery profile has changed."
          : generating || message.voice_status === "generating"
            ? "The voice note is being created. You can continue using the rest of the CRM."
            : scriptMissing
              ? "This older email draft has no voice script yet. Press Create voice script on this contact. No audio is generated by that action."
            : scriptApproved
              ? "The exact script is saved. Press Generate voice to create or retry the preview."
              : "Nothing is generated or charged until you press Generate voice. That one click approves the visible script and creates the preview."}
      </p>
      <p className="mt-1 text-xs leading-5 text-muted">
        A light invitation to reply for a quick call or demo is recommended when it fits. It remains optional. Urgency must come from a verified current trigger or the prospect&apos;s next natural business moment.
      </p>
      {message.voice_error && message.voice_status === "failed" ? (
        <p className="mt-2 rounded-lg border border-rust/40 bg-rust/10 px-3 py-2 text-xs leading-5 text-rust">
          {message.voice_error}
        </p>
      ) : null}
      {ready && message.voice_public_token ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-moss/35 bg-moss/[0.05] p-3">
          <button
            type="button"
            onClick={() => void togglePlayback()}
            aria-label={playing ? "Pause personal voice note" : "Play personal voice note"}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-moss/55 bg-moss/10 text-lg text-moss transition hover:bg-moss/20"
          >
            {playing ? "Ⅱ" : "▶"}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-bone">Voice note ready</p>
            <p className="mt-0.5 text-xs text-muted">
              About {message.voice_estimated_seconds || seconds} seconds. Play it if you want to check it before queueing the email.
            </p>
          </div>
          <audio
            key={`${message.voice_generated_at || ""}:${message.voice_script_hash || ""}`}
            ref={audioRef}
            className="hidden"
            preload="metadata"
            src={`/api/listen/${encodeURIComponent(message.voice_public_token)}/audio?v=${encodeURIComponent(message.voice_generated_at || message.voice_script_hash || "ready")}`}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
          <a
            href={`/listen/${encodeURIComponent(message.voice_public_token)}`}
            target="_blank"
            rel="noreferrer"
            className="w-full text-xs text-moss hover:underline sm:w-auto"
          >
            Open the recipient listening page ↗
          </a>
        </div>
      ) : null}
    </section>
  );
}
