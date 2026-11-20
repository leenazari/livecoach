"use client";
import {
  approvedAdamScript,
  ADAM_SCRIPT,
  cleanStage,
  savedAdamPitch,
  SALES_PRODUCTS,
  type SalesProduct,
} from "@/lib/sales-call-script";
type Props = {
  scriptVersion?: string;
  products: SalesProduct[];
  onChange: (v: SalesProduct[]) => void;
  stage: string;
  onStage: (v: string) => void;
  status: string;
  ready: boolean;
  improvement: string;
  onRetry: () => void;
  live?: boolean;
  pitch?: unknown;
  contextKey?: string;
  preparing?: boolean;
  onPrepare?: () => void;
};
export default function SalesScriptPanel(props: Props) {
  const script = approvedAdamScript(props.scriptVersion);
  const adam = props.products.includes("adam");
  const selectedStage = cleanStage(props.stage, script.version);
  const step =
    script.steps.find((s) => s.id === selectedStage) || script.steps[0];
  const pitch = script.version === ADAM_SCRIPT.version && props.contextKey
    ? savedAdamPitch(props.pitch, props.contextKey) : null;
  const questions = pitch?.steps.find(s => s.id === step.id)?.questions || step.questions;
  return (
    <section
      className="my-3 rounded-xl border border-sky/35 bg-panel p-4"
      aria-label="Product script"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <details className="relative">
          <summary className="cursor-pointer rounded-lg border border-edge px-3 py-2 text-sm text-bone">
            Product focus:{" "}
            {props.products.length
              ? SALES_PRODUCTS.filter((p) => props.products.includes(p.id))
                  .map((p) => p.label)
                  .join(" + ")
              : "No sales script selected"}
          </summary>
          <fieldset
            className="absolute left-0 z-[60] mt-1 min-w-64 rounded-xl border border-edge bg-panel p-3 shadow-xl"
            disabled={!props.ready}
          >
            <legend className="sr-only">Select products for this call</legend>
            {SALES_PRODUCTS.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2 py-2 text-sm text-bone"
              >
                <input
                  type="checkbox"
                  checked={props.products.includes(p.id)}
                  onChange={() =>
                    props.onChange(
                      props.products.includes(p.id)
                        ? props.products.filter((id) => id !== p.id)
                        : [...props.products, p.id],
                    )
                  }
                />
                {p.label}
              </label>
            ))}
            <p className="pt-2 text-xs text-muted">
              Leave clear for a non-sales call. Only you change the selection.
            </p>
          </fieldset>
        </details>
        <span
          role="status"
          aria-live="polite"
          className="max-w-xl text-xs text-muted"
        >
          {props.status}
        </span>
        {![
          "Saved",
          "Saving…",
          "Saved preparation loaded",
          "Loading saved preparation…",
        ].includes(props.status) && (
          <button
            type="button"
            onClick={props.onRetry}
            className="text-xs text-sky underline"
          >
            {props.ready ? "Save current draft" : "Load saved preparation"}
          </button>
        )}
      </div>
      {props.improvement && (
        <p className="mt-3 text-sm text-sage">
          Your next-call focus: {props.improvement}
        </p>
      )}
      {props.products.length > 0 && !adam && (
        <p className="mt-3 text-sm text-amber">
          Approved script awaiting Lee’s document. Your selected interests are
          saved; use the prepared call intent.
        </p>
      )}
      {adam && props.products.length > 1 && (
        <p className="mt-3 text-xs text-amber">
          Combined script awaiting approval. Adam’s approved sections are
          available; other interests remain saved.
        </p>
      )}
      {adam && (
        <>
          <div
            className="my-3 flex flex-wrap gap-2"
            role="group"
            aria-label="Script stage"
          >
            {script.steps.map((s, index) => (
              <button
                type="button"
                key={s.id}
                disabled={!props.ready}
                onClick={() => props.onStage(s.id)}
                aria-pressed={selectedStage === s.id}
                className={`min-h-10 rounded-full border px-3 py-2 text-sm ${selectedStage === s.id ? "border-amber bg-amber/15 text-amber" : "border-edge text-muted hover:text-bone"}`}
              >
                <span aria-hidden="true" className="mr-1.5 opacity-70">{index + 1}</span>{s.title}
              </button>
            ))}
          </div>
          <p className="text-xs uppercase tracking-wider text-sky">
            {step.minutes} · {step.title}
          </p>
          <p className="mt-1 text-sm text-bone/80">{step.guidance}</p>
          <ol aria-label={`${step.title} prompts`} className="mt-3 space-y-2">
            {questions.map((q, index) => (
              <li key={q} className="flex items-start gap-3 rounded-lg border border-edge bg-ink/40 px-3 py-2.5 text-base font-medium leading-relaxed text-bone">
                <span aria-hidden="true" className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky/10 text-xs text-sky">{index + 1}</span>
                <span>{q}</span>
              </li>
            ))}
          </ol>
          {script.version === ADAM_SCRIPT.version && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-xs text-muted">
                {pitch?.personalised ? "Tailored to this call’s business case, intent and research."
                  : "Starter prompts. Build or refresh focus to tailor all three sections to this client."}
                {props.live ? " Live cues adapt to what they say without changing your section." : " Changing sections does not generate more AI work."}
              </p>
              {!props.live && props.onPrepare && (
                <button type="button" onClick={props.onPrepare} disabled={!props.ready || props.preparing}
                  className="min-h-10 rounded-lg border border-sky/40 px-3 py-2 text-sm text-sky disabled:opacity-40">
                  {props.preparing ? "Preparing prompts…" : pitch?.personalised ? "Refresh client prompts" : "Tailor prompts to this client"}
                </button>
              )}
            </div>
          )}
          {!props.live && (
            <p className="mt-3 text-xs text-muted">
              Before the call: {script.before}
            </p>
          )}
          <p className="mt-3 text-xs text-muted">{script.rule}</p>
        </>
      )}
    </section>
  );
}
