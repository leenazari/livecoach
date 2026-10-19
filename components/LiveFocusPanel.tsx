"use client";

type Props = {
  focuses: string[];
  activeFocuses: string[];
  currentFocus: string;
  coverage: Record<string, number>;
  intentCoverage: number;
  busy: boolean;
  requestedFocus?: string;
  message?: string;
  error?: boolean;
  onRequest: (focus: string) => void;
};

export default function LiveFocusPanel({
  focuses, activeFocuses, currentFocus, coverage, intentCoverage,
  busy, requestedFocus, message, error, onRequest,
}: Props) {
  return (
    <aside className="max-h-[34vh] shrink-0 overflow-y-auto border-b border-edge bg-panel/55 p-4 lg:max-h-none lg:w-[270px] lg:border-b-0 lg:border-r lg:p-5">
      <div className="flex items-start justify-between gap-3 lg:block">
        <div>
          <p className="font-mono text-[0.56rem] uppercase tracking-[0.22em] text-amber">Core focus</p>
          <p id="live-focus-help" className="mt-1 text-xs leading-5 text-muted">
            Tap a focus for one fresh question. Your main call direction stays unchanged.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-edge px-2 py-1 font-mono text-[0.5rem] uppercase text-muted lg:mt-3 lg:inline-flex">
          {intentCoverage}% covered
        </span>
      </div>
      <p role="status" aria-live="polite" className={`mt-2 text-xs leading-5 ${error ? "text-rust" : "text-sage"}`}>
        {busy ? (requestedFocus ? "Creating your focus question…" : "Finishing the current cue…") : message}
      </p>
      {focuses.length ? (
        <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {focuses.map((focus, index) => {
            const active = activeFocuses.includes(focus);
            const current = focus === currentFocus;
            const pending = busy && focus === requestedFocus;
            const percent = Math.max(0, Math.min(100, coverage[focus] ?? 0));
            return (
              <li key={focus}>
                <button
                  type="button"
                  onClick={() => onRequest(focus)}
                  disabled={busy}
                  aria-label={`Get a suggestion for ${focus}`}
                  aria-describedby="live-focus-help"
                  aria-busy={pending}
                  className={`min-h-11 w-full rounded-lg border p-2.5 text-left transition hover:border-amber hover:bg-amber/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-wait disabled:opacity-60 ${
                    pending ? "border-sky bg-sky/10" : current ? "border-amber/55 bg-amber/[0.08]" : active ? "border-edge bg-ink/40" : "border-edge/50 bg-ink/20"
                  }`}
                >
                  <span className="flex items-start gap-2">
                    <span className={`font-mono text-[0.54rem] ${current ? "text-amber" : "text-muted"}`}>{index + 1}</span>
                    <span className="min-w-0 flex-1 text-sm leading-5 text-bone">{focus}</span>
                    <span className="font-mono text-[0.5rem] tabular-nums text-muted">{percent}%</span>
                  </span>
                  <span className="mt-2 block h-1 overflow-hidden rounded-full bg-ink">
                    <span className={`block h-full rounded-full ${current ? "bg-amber" : "bg-amber/45"}`} style={{ width: `${percent}%` }} />
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center justify-between gap-1 font-mono text-[0.48rem] uppercase tracking-wider">
                    <span className={current ? "text-amber" : "text-muted"}>{current ? "Current focus" : !active ? "Covered / paused" : "On your agenda"}</span>
                    <span className="text-sky">{pending ? "Creating…" : "✦ Get a cue"}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-edge p-3 text-xs text-muted">
          Build the call focus first to keep the key outcomes visible here.
        </p>
      )}
    </aside>
  );
}
