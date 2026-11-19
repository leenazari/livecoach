"use client";
import {
  ADAM_SCRIPT,
  SALES_PRODUCTS,
  type SalesProduct,
} from "@/lib/sales-call-script";
type Props = {
  products: SalesProduct[];
  onChange: (v: SalesProduct[]) => void;
  stage: string;
  onStage: (v: string) => void;
  status: string;
  ready: boolean;
  improvement: string;
  onRetry: () => void;
  live?: boolean;
};
export default function SalesScriptPanel(props: Props) {
  const adam = props.products.includes("adam");
  const step =
    ADAM_SCRIPT.steps.find((s) => s.id === props.stage) || ADAM_SCRIPT.steps[0];
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
            {ADAM_SCRIPT.steps.map((s) => (
              <button
                type="button"
                key={s.id}
                disabled={!props.ready}
                onClick={() => props.onStage(s.id)}
                aria-pressed={props.stage === s.id}
                className={`rounded-full border px-3 py-1 text-xs ${props.stage === s.id ? "border-amber bg-amber/15 text-amber" : "border-edge text-muted"}`}
              >
                {s.title}
              </button>
            ))}
          </div>
          <p className="text-xs uppercase tracking-wider text-sky">
            {step.minutes} · {step.title}
          </p>
          <p className="mt-1 text-sm text-bone/80">{step.guidance}</p>
          <ul className="mt-2 space-y-1">
            {step.questions.map((q) => (
              <li key={q} className="text-base font-medium text-bone">
                {q}
              </li>
            ))}
          </ul>
          {!props.live && (
            <p className="mt-3 text-xs text-muted">
              Before the call: {ADAM_SCRIPT.before}
            </p>
          )}
          <p className="mt-3 text-xs text-muted">{ADAM_SCRIPT.rule}</p>
        </>
      )}
    </section>
  );
}
