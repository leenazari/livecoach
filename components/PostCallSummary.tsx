"use client";

type Comp = { name: string; score: number; note: string };
type Summary = {
  recommendation: string;
  headline: string;
  strengths: string[];
  concerns: string[];
  competencies: Comp[];
  notCovered: string[];
  styleProfile: string;
};

function Dots({ score }: { score: number }) {
  const s = Math.max(0, Math.min(5, Math.round(score || 0)));
  return (
    <span className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`h-2 w-2 rounded-full ${n <= s ? "bg-amber" : "bg-edge"}`}
        />
      ))}
    </span>
  );
}

function SummaryList({
  title,
  items,
  tone,
}: {
  title: string;
  items?: string[];
  tone: "sage" | "rust" | "muted";
}) {
  if (!items || items.length === 0) return null;
  const dot =
    tone === "sage" ? "bg-sage" : tone === "rust" ? "bg-rust" : "bg-muted";
  return (
    <div>
      <h3 className="mb-2 font-mono text-[0.7rem] uppercase tracking-[0.25em] text-muted">
        {title}
      </h3>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2.5 font-sans text-sm text-bone/85">
            <span
              className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${dot}`}
            />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PostCallSummary({
  summary,
  candidate,
  onClose,
}: {
  summary: Summary;
  candidate?: string;
  onClose?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/80 p-4 backdrop-blur-sm sm:p-8">
      <div className="my-auto w-full max-w-[760px] rounded-2xl border border-edge bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-6 py-4">
          <div>
            <h2 className="font-display text-2xl text-bone">Interview summary</h2>
            {candidate && (
              <p className="mt-0.5 font-mono text-xs uppercase tracking-[0.2em] text-muted">
                {candidate}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-edge px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-muted transition hover:border-rust hover:text-rust"
          >
            close
          </button>
        </div>

        <div className="space-y-6 px-6 py-6">
          <div className="rounded-xl border border-amber/40 bg-amber/[0.07] px-5 py-4">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.25em] text-amber/70">
              recommendation
            </p>
            <p className="mt-1 font-display text-xl text-bone">
              {summary.recommendation}
            </p>
            {summary.headline && (
              <p className="mt-2 font-sans text-sm text-bone/80">
                {summary.headline}
              </p>
            )}
          </div>

          {summary.competencies && summary.competencies.length > 0 && (
            <div>
              <h3 className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.25em] text-muted">
                Competencies
              </h3>
              <div className="space-y-2.5">
                {summary.competencies.map((c, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-4"
                  >
                    <div>
                      <p className="font-sans text-sm text-bone">{c.name}</p>
                      {c.note && (
                        <p className="font-sans text-xs text-muted">{c.note}</p>
                      )}
                    </div>
                    <div className="flex-none pt-1">
                      <Dots score={c.score} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <SummaryList title="Strengths" items={summary.strengths} tone="sage" />
          <SummaryList title="Concerns" items={summary.concerns} tone="rust" />
          <SummaryList
            title="Not yet covered"
            items={summary.notCovered}
            tone="muted"
          />

          {summary.styleProfile && (
            <div className="rounded-xl border border-edge bg-ink/40 px-5 py-4">
              <p className="mb-1 font-mono text-[0.6rem] uppercase tracking-[0.25em] text-muted">
                interviewer style profile (for future cue matching)
              </p>
              <p className="font-sans text-sm text-bone/80">
                {summary.styleProfile}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
