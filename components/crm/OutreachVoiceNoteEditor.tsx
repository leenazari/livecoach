"use client";

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
  voice_estimated_seconds?: number | null;
  voice_estimated_cost_gbp?: number | null;
  voice_error?: string | null;
  voice_script_approved_at?: string | null;
  voice_script_approved_by?: string | null;
  voice_script_approved_hash?: string | null;
};

export default function OutreachVoiceNoteEditor({
  message,
  script,
  disabled,
  approving,
  generating,
  onScriptChange,
  onApprove,
  onGenerate,
}: {
  message: VoiceMessage;
  script: string;
  disabled?: boolean;
  approving?: boolean;
  generating?: boolean;
  onScriptChange: (value: string) => void;
  onApprove: () => void;
  onGenerate: () => void;
}) {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
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
  const beyondSafetyLimit = words > 0 && (
    words > OUTREACH_VOICE_HARD_MAX_WORDS ||
    characters > OUTREACH_VOICE_HARD_MAX_CHARACTERS ||
    estimatedCostPence > OUTREACH_VOICE_HARD_MAX_COST_GBP * 100
  );
  const locked = disabled || ["sending", "sent"].includes(message.status || "");

  return (
    <section className="rounded-xl border border-amber/40 bg-amber/[0.05] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[0.52rem] uppercase tracking-wider text-amber">
            Personal voice note
          </p>
          <p className="mt-1 text-xs leading-5 text-bone/75">
            Review and edit the free script first. Approving the words costs nothing. ElevenLabs is called only after you separately create the voice.
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
              ? "Edited · approve again"
              : scriptApproved
                ? "Script approved · no cost yet"
              : message.voice_status === "failed"
                ? "Needs retry"
                : "Review script"}
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
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs ${beyondSafetyLimit ? "text-rust" : outsidePreferredRange || overTargetCost ? "text-amber" : "text-muted"}`}>
          {words} words · about {seconds} seconds · estimated {estimatedCostPence.toFixed(1)}p. Aim for about {OUTREACH_VOICE_TARGET_WORDS} words, usually {OUTREACH_VOICE_PREFERRED_MIN_WORDS} to {OUTREACH_VOICE_PREFERRED_MAX_WORDS}.
        </p>
        {!locked ? (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              type="button"
              onClick={onApprove}
              disabled={
                approving ||
                generating ||
                ready ||
                scriptApproved ||
                beyondSafetyLimit ||
                !script.trim()
              }
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-edge bg-ink/35 px-3 py-2 font-mono text-[0.54rem] uppercase tracking-wider text-bone disabled:cursor-not-allowed disabled:opacity-40"
            >
              {approving
                ? "Approving script…"
                : scriptApproved || ready
                  ? "✓ Script approved"
                  : "1 · Approve script"}
            </button>
            <button
              type="button"
              onClick={onGenerate}
              disabled={
                approving ||
                generating ||
                ready ||
                !scriptApproved ||
                beyondSafetyLimit ||
                !script.trim()
              }
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-amber/55 bg-amber/10 px-3 py-2 font-mono text-[0.54rem] uppercase tracking-wider text-amber disabled:cursor-not-allowed disabled:opacity-40"
            >
              {generating
                ? "Creating voice…"
                : ready
                  ? "✓ Audio ready"
                  : `2 · Generate voice · est ${estimatedCostPence.toFixed(1)}p`}
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
          ? "This one approved voice note has been generated and can now be previewed."
          : scriptApproved
            ? "The exact script is approved. Generation still has not started and no voice cost has been incurred."
            : "Nothing is generated or charged until you approve this exact script and then press Generate voice."}
      </p>
      {message.voice_error && message.voice_status === "failed" ? (
        <p className="mt-2 rounded-lg border border-rust/40 bg-rust/10 px-3 py-2 text-xs leading-5 text-rust">
          {message.voice_error}
        </p>
      ) : null}
      {ready && message.voice_public_token ? (
        <div className="mt-3 rounded-lg border border-moss/35 bg-moss/[0.05] p-3">
          <audio
            className="w-full"
            controls
            preload="metadata"
            src={`/api/listen/${encodeURIComponent(message.voice_public_token)}/audio`}
          />
          <a
            href={`/listen/${encodeURIComponent(message.voice_public_token)}`}
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
