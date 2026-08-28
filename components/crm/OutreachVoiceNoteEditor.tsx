"use client";

type VoiceMessage = {
  id?: string;
  status?: string;
  voice_script?: string | null;
  voice_status?: string | null;
  voice_public_token?: string | null;
  voice_estimated_seconds?: number | null;
  voice_error?: string | null;
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
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  const scriptChanged = script.trim() !== String(message.voice_script || "").trim();
  const ready = message.voice_status === "ready" && !scriptChanged;
  const seconds = Math.max(20, Math.min(90, Math.round((words / 135) * 60)));
  const needsLengthReview = words > 0 && (words < 105 || words > 135);
  const locked = disabled || ["sending", "sent"].includes(message.status || "");

  return (
    <section className="rounded-xl border border-amber/40 bg-amber/[0.05] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[0.52rem] uppercase tracking-wider text-amber">
            Personal voice note
          </p>
          <p className="mt-1 text-xs leading-5 text-bone/75">
            This spoken pitch is generated once in your own ElevenLabs voice and appears as a listen button in the email.
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-1 font-mono text-[0.48rem] uppercase ${
            ready
              ? "border-moss/50 bg-moss/10 text-moss"
              : needsLengthReview
                ? "border-rust/50 bg-rust/10 text-rust"
                : "border-amber/45 bg-amber/10 text-amber"
          }`}
        >
          {ready
            ? `Ready · ${message.voice_estimated_seconds || seconds}s`
            : scriptChanged && message.voice_status === "ready"
              ? "Edited · regenerate"
              : message.voice_status === "failed"
                ? "Needs retry"
                : "Audio not created"}
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
        <p className={`text-xs ${needsLengthReview ? "text-rust" : "text-muted"}`}>
          {words} words · about {seconds} seconds. Aim for 105 to 135 words.
        </p>
        {!locked ? (
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating || ready || needsLengthReview || !script.trim()}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-amber/55 bg-amber/10 px-3 py-2 font-mono text-[0.54rem] uppercase tracking-wider text-amber disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generating
              ? "Creating voice…"
              : ready
                ? "Audio ready"
                : "Create voice preview"}
          </button>
        ) : null}
      </div>
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
