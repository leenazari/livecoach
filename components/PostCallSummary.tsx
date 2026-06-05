"use client";

type Comp = { name: string; score: number; note: string };
type QReview = { question: string; answered: string; note: string };
type Summary = {
  recommendation: string;
  headline: string;
  strengths: string[];
  concerns: string[];
  competencies: Comp[];
  questionReview: QReview[];
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
  transcript,
  onClose,
}: {
  summary: Summary;
  candidate?: string;
  transcript?: string;
  onClose?: () => void;
}) {
  const downloadPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 48;
    const pageH = doc.internal.pageSize.getHeight();
    const width = doc.internal.pageSize.getWidth() - margin * 2;
    let y = margin;

    const ensure = (space: number) => {
      if (y + space > pageH - margin) {
        doc.addPage();
        y = margin;
      }
    };
    const heading = (t: string) => {
      ensure(26);
      y += 6;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(20);
      doc.text(t.toUpperCase(), margin, y);
      y += 16;
    };
    const para = (t: string, size = 10, color = 40) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      doc.setTextColor(color);
      doc.splitTextToSize(t, width).forEach((ln: string) => {
        ensure(size + 5);
        doc.text(ln, margin, y);
        y += size + 5;
      });
    };
    const bullet = (t: string) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(40);
      doc.splitTextToSize(t, width - 16).forEach((ln: string, i: number) => {
        ensure(15);
        if (i === 0) doc.text("-", margin, y);
        doc.text(ln, margin + 14, y);
        y += 15;
      });
    };

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(15);
    doc.text("Interview Summary", margin, y);
    y += 24;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(110);
    const meta = [
      candidate ? `Candidate: ${candidate}` : "",
      `Date: ${new Date().toLocaleDateString()}`,
    ]
      .filter(Boolean)
      .join("     ");
    doc.text(meta, margin, y);
    y += 14;

    heading("Recommendation");
    para(summary.recommendation || "-", 12, 20);
    if (summary.headline) para(summary.headline, 10, 70);

    if (summary.competencies && summary.competencies.length > 0) {
      heading("Competencies");
      summary.competencies.forEach((c) => {
        const score = Math.max(0, Math.min(5, Math.round(c.score || 0)));
        bullet(`${c.name}  -  ${score}/5${c.note ? `  -  ${c.note}` : ""}`);
      });
    }

    if (summary.questionReview && summary.questionReview.length > 0) {
      heading("Question by question");
      summary.questionReview.forEach((q) => {
        const tag = (q.answered || "").toUpperCase();
        bullet(`[${tag}] ${q.question}${q.note ? `  -  ${q.note}` : ""}`);
      });
    }

    const list = (title: string, items?: string[]) => {
      if (items && items.length > 0) {
        heading(title);
        items.forEach((it) => bullet(it));
      }
    };
    list("Strengths", summary.strengths);
    list("Concerns", summary.concerns);
    list("Not yet covered", summary.notCovered);

    if (summary.styleProfile) {
      heading("Interviewer style profile");
      para(summary.styleProfile);
    }

    if (transcript && transcript.trim()) {
      heading("Full transcript");
      transcript.split("\n").forEach((line) => {
        if (line.trim()) para(line, 9, 60);
      });
    }

    const safe = (candidate || "interview")
      .replace(/[^a-z0-9]+/gi, "_")
      .toLowerCase();
    doc.save(`interview_summary_${safe}.pdf`);
  };

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
          <div className="flex gap-2">
            <button
              onClick={downloadPdf}
              className="rounded-full border border-amber/50 bg-amber/10 px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-amber transition hover:bg-amber/20"
            >
              download pdf
            </button>
            <button
              onClick={onClose}
              className="rounded-full border border-edge px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-muted transition hover:border-rust hover:text-rust"
            >
              close
            </button>
          </div>
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

          {summary.questionReview && summary.questionReview.length > 0 && (
            <div>
              <h3 className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.25em] text-muted">
                Question by question
              </h3>
              <div className="space-y-2">
                {summary.questionReview.map((q, i) => {
                  const a = (q.answered || "").toLowerCase();
                  const tone =
                    a === "yes"
                      ? { dot: "bg-sage", label: "text-sage", text: "answered" }
                      : a === "partial"
                      ? { dot: "bg-amber", label: "text-amber", text: "partial" }
                      : { dot: "bg-rust", label: "text-rust", text: "dodged" };
                  return (
                    <div
                      key={i}
                      className="rounded-xl border border-edge bg-ink/40 px-4 py-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${tone.dot}`}
                        />
                        <div>
                          <p className="font-sans text-sm text-bone">
                            {q.question}
                          </p>
                          <p className="mt-0.5 font-sans text-xs text-muted">
                            <span
                              className={`font-mono uppercase tracking-wider ${tone.label}`}
                            >
                              {tone.text}
                            </span>
                            {q.note ? ` - ${q.note}` : ""}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
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
