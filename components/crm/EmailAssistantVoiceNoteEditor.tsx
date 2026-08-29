"use client";

import Link from "next/link";

import {
  EMAIL_ASSISTANT_VOICE_HARD_MAX_CHARACTERS,
  EMAIL_ASSISTANT_VOICE_HARD_MAX_COST_GBP,
  EMAIL_ASSISTANT_VOICE_HARD_MAX_WORDS,
  EMAIL_ASSISTANT_VOICE_PREFERRED_MAX_WORDS,
  EMAIL_ASSISTANT_VOICE_PREFERRED_MIN_WORDS,
  EMAIL_ASSISTANT_VOICE_TARGET_COST_GBP,
  EMAIL_ASSISTANT_VOICE_TARGET_WORDS,
  emailAssistantVoiceReadyForDisplayedScript,
  estimateEmailAssistantVoiceCostGbp,
  normaliseEmailAssistantVoiceScript,
} from "@/lib/email-assistant-voice-policy";

type EmailAssistantVoiceDraft = {
  status?: string;
  voice_script?: string | null;
  voice_status?: string | null;
  voice_audio_path?: string | null;
  voice_public_token?: string | null;
  voice_script_hash?: string | null;
  voice_model_id?: string | null;
  voice_provider_voice_id?: string | null;
  voice_estimated_seconds?: number | null;
  voice_estimated_cost_gbp?: number | null;
  voice_error?: string | null;
  voice_script_approved_at?: string | null;
  voice_script_approved_by?: string | null;
  voice_script_approved_hash?: string | null;
};

export default function EmailAssistantVoiceNoteEditor({
  draft,
  script,
  voiceConfigured,
  disabled,
  approving,
  generating,
  onScriptChange,
  onApprove,
  onGenerate,
}: {
  draft: EmailAssistantVoiceDraft;
  script: string;
  voiceConfigured: boolean;
  disabled?: boolean;
  approving?: boolean;
  generating?: boolean;
  onScriptChange: (value: string) => void;
  onApprove: () => void;
  onGenerate: () => void;
}) {
  const normalisedScript = normaliseEmailAssistantVoiceScript(script);
  const savedScript = normaliseEmailAssistantVoiceScript(draft.voice_script);
  const words = normalisedScript.split(/\s+/).filter(Boolean).length;
  const scriptChanged = normalisedScript !== savedScript;
  const ready = emailAssistantVoiceReadyForDisplayedScript(draft, script);
  const scriptApproved =
    !scriptChanged &&
    Boolean(draft.voice_script_approved_at) &&
    Boolean(draft.voice_script_approved_by) &&
    Boolean(draft.voice_script_approved_hash);
  const seconds = Math.max(20, Math.min(90, Math.round((words / 135) * 60)));
  const characters = normalisedScript.length;
  const generatedCostPence = scriptChanged
    ? 0
    : Number(draft.voice_estimated_cost_gbp || 0) * 100;
  const estimatedCostPence =
    generatedCostPence > 0
      ? generatedCostPence
      : estimateEmailAssistantVoiceCostGbp(normalisedScript) * 100;
  const outsidePreferredRange =
    words > 0 &&
    (words < EMAIL_ASSISTANT_VOICE_PREFERRED_MIN_WORDS ||
      words > EMAIL_ASSISTANT_VOICE_PREFERRED_MAX_WORDS);
  const overTargetCost =
    estimatedCostPence > EMAIL_ASSISTANT_VOICE_TARGET_COST_GBP * 100;
  const beyondSafetyLimit =
    words > 0 &&
    (words > EMAIL_ASSISTANT_VOICE_HARD_MAX_WORDS ||
      characters > EMAIL_ASSISTANT_VOICE_HARD_MAX_CHARACTERS ||
      estimatedCostPence > EMAIL_ASSISTANT_VOICE_HARD_MAX_COST_GBP * 100);
  const locked = disabled || ["sending", "sent"].includes(draft.status || "");

  return (
    <section className="rounded-xl border border-sky/40 bg-sky/[0.05] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[0.52rem] uppercase tracking-wider text-sky">
            Email Assistant reply voice
          </p>
          <p className="mt-1 text-xs leading-5 text-bone/75">
            Review the free script first. Approving it costs nothing. Paid audio starts only after you separately press Generate reply voice.
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-1 font-mono text-[0.48rem] uppercase ${
            ready
              ? "border-moss/50 bg-moss/10 text-moss"
              : !voiceConfigured || beyondSafetyLimit
                ? "border-rust/50 bg-rust/10 text-rust"
                : "border-sky/45 bg-sky/10 text-sky"
          }`}
        >
          {!voiceConfigured
            ? "Reply voice not set"
            : ready
              ? `Ready · ${draft.voice_estimated_seconds || seconds}s${generatedCostPence > 0 ? ` · est ${generatedCostPence.toFixed(1)}p` : ""}`
              : scriptChanged && draft.voice_status === "ready"
                ? "Edited · regenerate voice"
                : scriptApproved
                  ? "Script approved · no cost yet"
                  : draft.voice_status === "failed"
                    ? "Needs retry"
                    : "Review script"}
        </span>
      </div>

      {!voiceConfigured ? (
        <div className="mt-3 rounded-lg border border-amber/45 bg-amber/[0.06] px-3 py-2 text-xs leading-5 text-amber">
          Choose your own Email Assistant reply voice before approving or generating audio. Email-only approval remains available.
          <Link
            href="/settings/sales-profile"
            className="ml-1 font-semibold underline"
          >
            Choose reply voice
          </Link>
        </div>
      ) : null}

      <label className="mt-3 block">
        <span className="sr-only">Email Assistant reply voice script</span>
        <textarea
          rows={7}
          value={script}
          onChange={(event) => onScriptChange(event.target.value)}
          disabled={locked}
          className="w-full rounded-lg border border-edge bg-ink/55 px-3 py-2 text-sm leading-6 text-bone outline-none focus:border-sky/60 disabled:opacity-60"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p
          className={`text-xs ${
            beyondSafetyLimit
              ? "text-rust"
              : outsidePreferredRange || overTargetCost
                ? "text-amber"
                : "text-muted"
          }`}
        >
          {words} words · about {seconds} seconds · estimated {estimatedCostPence.toFixed(1)}p. Aim for about {EMAIL_ASSISTANT_VOICE_TARGET_WORDS} words, usually {EMAIL_ASSISTANT_VOICE_PREFERRED_MIN_WORDS} to {EMAIL_ASSISTANT_VOICE_PREFERRED_MAX_WORDS}.
        </p>
        {!locked ? (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              type="button"
              onClick={onApprove}
              disabled={
                !voiceConfigured ||
                approving ||
                generating ||
                ready ||
                scriptApproved ||
                beyondSafetyLimit ||
                !normalisedScript
              }
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-edge bg-ink/35 px-3 py-2 font-mono text-[0.54rem] uppercase tracking-wider text-bone disabled:cursor-not-allowed disabled:opacity-40"
            >
              {approving
                ? "Approving script…"
                : scriptApproved || ready
                  ? "✓ Script approved"
                  : "1 · Approve reply script"}
            </button>
            <button
              type="button"
              onClick={onGenerate}
              disabled={
                !voiceConfigured ||
                approving ||
                generating ||
                ready ||
                !scriptApproved ||
                beyondSafetyLimit ||
                !normalisedScript
              }
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-sky/55 bg-sky/10 px-3 py-2 font-mono text-[0.54rem] uppercase tracking-wider text-sky disabled:cursor-not-allowed disabled:opacity-40"
            >
              {generating
                ? "Creating reply voice…"
                : ready
                  ? "✓ Reply audio ready"
                  : `2 · Generate reply voice · est ${estimatedCostPence.toFixed(1)}p`}
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
          ? "This exact approved reply voice is ready to preview."
          : scriptApproved
            ? "The exact script is approved. Generation has not started and no voice cost has been incurred."
            : "Nothing is generated or charged until you approve this exact script and then press Generate reply voice."}
      </p>
      {draft.voice_error && draft.voice_status === "failed" ? (
        <p className="mt-2 rounded-lg border border-rust/40 bg-rust/10 px-3 py-2 text-xs leading-5 text-rust">
          {draft.voice_error}
        </p>
      ) : null}
      {ready && draft.voice_public_token ? (
        <div className="mt-3 rounded-lg border border-moss/35 bg-moss/[0.05] p-3">
          <audio
            className="w-full"
            controls
            preload="metadata"
            src={`/api/listen/next-move/${encodeURIComponent(draft.voice_public_token)}/audio`}
          />
          <a
            href={`/listen/next-move/${encodeURIComponent(draft.voice_public_token)}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs text-moss hover:underline"
          >
            Open the recipient listening page ↗
          </a>
        </div>
      ) : null}
    </section>
  );
}
