"use client";

import { useState } from "react";

type Comp = { name: string; score: number; note: string };
type QReview = { question: string; answered: string; note: string };
type Contributor = { name: string; impact: string; note: string };
type Summary = {
  callType?: string;
  title?: string;
  recommendation: string;
  headline: string;
  overview?: string;
  strengths: string[];
  concerns: string[];
  competencies: Comp[];
  contributors?: Contributor[];
  questionReview: QReview[];
  myNextActions?: string[];
  theirNextActions?: string[];
  suggestedNextActions?: string[];
  notCovered: string[];
  styleProfile: string;
};

const clamp = (n: number) => Math.max(0, Math.min(5, Math.round(n || 0)));
const pct = (score: number) => Math.round((clamp(score) / 5) * 100);

function CompBar({ score }: { score: number }) {
  const p = pct(score);
  const s = clamp(score);
  const color = s >= 4 ? "bg-sage" : s >= 3 ? "bg-amber" : "bg-rust";
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-2 w-28 overflow-hidden rounded-full bg-ink/70">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${color}`}
          style={{ width: `${p}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-[0.7rem] tabular-nums text-muted">
        {p}%
      </span>
    </div>
  );
}

function ActionSection({
  title,
  items,
  accent,
}: {
  title: string;
  items?: string[];
  accent: "amber" | "sky" | "sage";
}) {
  if (!items || items.length === 0) return null;
  const box =
    accent === "amber"
      ? "border-amber/40 bg-amber/[0.06]"
      : accent === "sky"
      ? "border-sky/40 bg-sky/[0.06]"
      : "border-sage/40 bg-sage/[0.06]";
  const tick =
    accent === "amber"
      ? "border-amber/60 text-amber"
      : accent === "sky"
      ? "border-sky/60 text-sky"
      : "border-sage/60 text-sage";
  const head =
    accent === "amber"
      ? "text-amber"
      : accent === "sky"
      ? "text-sky"
      : "text-sage";
  return (
    <div className={`rounded-xl border px-5 py-4 ${box}`}>
      <h3 className={`mb-2.5 font-mono text-[0.66rem] uppercase tracking-[0.22em] ${head}`}>
        {title}
      </h3>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2.5 font-sans text-sm text-bone/90">
            <span
              className={`mt-0.5 flex h-3.5 w-3.5 flex-none items-center justify-center rounded border text-[0.55rem] ${tick}`}
            >
              {"✓"}
            </span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
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
            <span className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${dot}`} />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function impactTone(impact: string) {
  const i = (impact || "").toLowerCase();
  if (i === "helped") return { dot: "bg-sage", label: "text-sage" };
  if (i === "blocked") return { dot: "bg-rust", label: "text-rust" };
  if (i === "mixed") return { dot: "bg-amber", label: "text-amber" };
  return { dot: "bg-muted", label: "text-muted" };
}

type FeedbackCue = { text: string; why: string; kind: string };

export default function PostCallSummary({
  summary,
  candidate,
  transcript,
  liked,
  disliked,
  onSaveFeedback,
  onClose,
}: {
  summary: Summary;
  candidate?: string;
  transcript?: string;
  liked?: FeedbackCue[];
  disliked?: FeedbackCue[];
  onSaveFeedback?: (notes: string) => Promise<void> | void;
  onClose?: () => void;
}) {
  const [debriefNotes, setDebriefNotes] = useState("");
  const [savedFeedback, setSavedFeedback] = useState(false);
  const callTypeLabel =
    summary.callType && summary.callType !== "general"
      ? `${summary.callType} call`
      : "call";

  const downloadPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const M = 48;
    const W = PW - M * 2;

    const INK: [number, number, number] = [22, 20, 16];
    const AMBER: [number, number, number] = [232, 163, 61];
    const MUTE: [number, number, number] = [120, 116, 108];
    const LINE: [number, number, number] = [226, 222, 214];
    const SAGE: [number, number, number] = [108, 148, 108];
    const RUST: [number, number, number] = [198, 92, 72];
    const SKY: [number, number, number] = [86, 138, 178];

    let y = 0;
    let page = 1;

    const footer = () => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTE);
      doc.text(
        `LiveCoach  ·  generated ${new Date().toLocaleDateString()}`,
        M,
        PH - 28
      );
      doc.text(`${page}`, PW - M, PH - 28, { align: "right" });
    };
    const ensure = (h: number) => {
      if (y + h > PH - 50) {
        footer();
        doc.addPage();
        page += 1;
        y = 56;
      }
    };
    const section = (t: string) => {
      ensure(30);
      y += 6;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(...AMBER);
      doc.text(t.toUpperCase(), M, y);
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.7);
      doc.line(M, y + 6, M + W, y + 6);
      y += 20;
    };
    const para = (
      t: string,
      size = 10,
      color: [number, number, number] = INK
    ) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      doc.splitTextToSize(t, W).forEach((ln: string) => {
        ensure(size + 5);
        doc.text(ln, M, y);
        y += size + 5;
      });
    };
    const bullet = (t: string, color: [number, number, number] = INK) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.splitTextToSize(t, W - 16).forEach((ln: string, i: number) => {
        ensure(15);
        if (i === 0) {
          doc.setFillColor(...color);
          doc.circle(M + 3, y - 3, 1.6, "F");
        }
        doc.setTextColor(...INK);
        doc.text(ln, M + 14, y);
        y += 15;
      });
    };
    const checkbox = (t: string, color: [number, number, number]) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.splitTextToSize(t, W - 20).forEach((ln: string, i: number) => {
        ensure(16);
        if (i === 0) {
          doc.setDrawColor(...color);
          doc.setLineWidth(1);
          doc.roundedRect(M, y - 8.5, 9, 9, 1.5, 1.5, "S");
        }
        doc.setTextColor(...INK);
        doc.text(ln, M + 17, y);
        y += 15;
      });
      y += 3;
    };
    const actionBlock = (
      title: string,
      items: string[] | undefined,
      color: [number, number, number]
    ) => {
      if (!items || items.length === 0) return;
      section(title);
      items.forEach((it) => checkbox(it, color));
      y += 4;
    };

    // ---- header band ----
    doc.setFillColor(...INK);
    doc.rect(0, 0, PW, 98, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(...AMBER);
    doc.text("LiveCoach", M, 44);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(13);
    doc.setTextColor(236, 231, 218);
    doc.splitTextToSize(summary.title || "Call summary", W).slice(0, 1).forEach((ln: string) => {
      doc.text(ln, M, 68);
    });
    doc.setFontSize(9);
    doc.setTextColor(150, 145, 135);
    const meta = [
      callTypeLabel,
      candidate ? `with ${candidate}` : "",
      new Date().toLocaleDateString(),
    ]
      .filter(Boolean)
      .join("   ·   ");
    doc.text(meta, M, 86);
    y = 128;

    // ---- recommendation card ----
    ensure(56);
    doc.setFillColor(250, 244, 232);
    doc.setDrawColor(...AMBER);
    doc.setLineWidth(0.8);
    doc.roundedRect(M, y, W, 50, 6, 6, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(170, 125, 45);
    doc.text("RECOMMENDATION", M + 14, y + 17);
    doc.setFontSize(15);
    doc.setTextColor(...INK);
    doc.text(summary.recommendation || "-", M + 14, y + 36);
    y += 66;

    // ---- how it went ----
    if (summary.overview || summary.headline) {
      section("How it went");
      para(summary.overview || summary.headline);
      y += 4;
    }

    // ---- scoring with bars ----
    if (summary.competencies && summary.competencies.length > 0) {
      section("Scoring");
      summary.competencies.forEach((c) => {
        const s = clamp(c.score);
        const p = pct(c.score);
        ensure(26);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(...INK);
        doc.text(c.name, M, y);
        doc.setTextColor(...MUTE);
        doc.text(`${p}%`, M + W, y, { align: "right" });
        const barY = y + 5;
        doc.setFillColor(...LINE);
        doc.roundedRect(M, barY, W, 5, 2.5, 2.5, "F");
        const col = s >= 4 ? SAGE : s >= 3 ? AMBER : RUST;
        doc.setFillColor(...col);
        doc.roundedRect(M, barY, Math.max(4, (W * s) / 5), 5, 2.5, 2.5, "F");
        y += 15;
        if (c.note) {
          doc.setFontSize(8.5);
          doc.setTextColor(...MUTE);
          doc.splitTextToSize(c.note, W).forEach((ln: string) => {
            ensure(11);
            doc.text(ln, M, y);
            y += 11;
          });
        }
        y += 7;
      });
    }

    // ---- action blocks ----
    actionBlock("Your next actions", summary.myNextActions, AMBER);
    actionBlock("Their next actions", summary.theirNextActions, SKY);
    actionBlock("Suggested next actions", summary.suggestedNextActions, SAGE);

    // ---- strengths / concerns ----
    const list = (
      title: string,
      items: string[] | undefined,
      color: [number, number, number]
    ) => {
      if (items && items.length > 0) {
        section(title);
        items.forEach((it) => bullet(it, color));
        y += 2;
      }
    };
    list("Strengths", summary.strengths, SAGE);
    list("Concerns", summary.concerns, RUST);

    if (summary.contributors && summary.contributors.length > 0) {
      section("Contributors");
      summary.contributors.forEach((c) => {
        bullet(
          `${c.name}  (${(c.impact || "neutral").toLowerCase()})${
            c.note ? `  -  ${c.note}` : ""
          }`,
          MUTE
        );
      });
      y += 2;
    }

    if (summary.questionReview && summary.questionReview.length > 0) {
      section("Key questions");
      summary.questionReview.forEach((q) => {
        const tag = (q.answered || "").toUpperCase();
        bullet(`[${tag}] ${q.question}${q.note ? `  -  ${q.note}` : ""}`, MUTE);
      });
      y += 2;
    }

    list("Not yet covered", summary.notCovered, MUTE);

    if (summary.styleProfile) {
      section("Your style profile");
      para(summary.styleProfile, 10, MUTE);
    }

    if (transcript && transcript.trim()) {
      section("Full transcript");
      transcript.split("\n").forEach((line) => {
        if (line.trim()) para(line, 9, [90, 86, 80]);
      });
    }

    footer();

    const safe = (summary.title || candidate || callTypeLabel)
      .replace(/[^a-z0-9]+/gi, "_")
      .toLowerCase()
      .slice(0, 50);
    doc.save(`livecoach_summary_${safe}.pdf`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/80 p-4 backdrop-blur-sm sm:p-8">
      <div className="my-auto w-full max-w-[760px] rounded-2xl border border-edge bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-6 py-4">
          <div>
            <h2 className="font-display text-2xl text-bone">
              {summary.title || "Call summary"}
            </h2>
            <p className="mt-0.5 font-mono text-xs uppercase tracking-[0.2em] text-muted">
              {callTypeLabel}
              {candidate ? ` · ${candidate}` : ""}
            </p>
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
            {(summary.overview || summary.headline) && (
              <p className="mt-2 font-sans text-sm leading-relaxed text-bone/80">
                {summary.overview || summary.headline}
              </p>
            )}
          </div>

          {summary.competencies && summary.competencies.length > 0 && (
            <div>
              <h3 className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.25em] text-muted">
                Scoring
              </h3>
              <div className="space-y-2.5">
                {summary.competencies.map((c, i) => (
                  <div key={i} className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-sans text-sm text-bone">{c.name}</p>
                      {c.note && (
                        <p className="font-sans text-xs text-muted">{c.note}</p>
                      )}
                    </div>
                    <div className="flex-none pt-1">
                      <CompBar score={c.score} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(summary.myNextActions?.length ||
            summary.theirNextActions?.length ||
            summary.suggestedNextActions?.length) && (
            <div className="space-y-3">
              <ActionSection
                title="Your next actions"
                items={summary.myNextActions}
                accent="amber"
              />
              <ActionSection
                title="Their next actions"
                items={summary.theirNextActions}
                accent="sky"
              />
              <ActionSection
                title="Suggested next actions"
                items={summary.suggestedNextActions}
                accent="sage"
              />
            </div>
          )}

          {summary.contributors && summary.contributors.length > 0 && (
            <div>
              <h3 className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.25em] text-muted">
                Contributors
              </h3>
              <div className="space-y-2">
                {summary.contributors.map((c, i) => {
                  const tone = impactTone(c.impact);
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
                            {c.name}{" "}
                            <span
                              className={`ml-1 font-mono text-[0.58rem] uppercase tracking-wider ${tone.label}`}
                            >
                              {(c.impact || "neutral").toLowerCase()}
                            </span>
                          </p>
                          {c.note && (
                            <p className="mt-0.5 font-sans text-xs text-muted">
                              {c.note}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {summary.questionReview && summary.questionReview.length > 0 && (
            <div>
              <h3 className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.25em] text-muted">
                Key questions
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

          {(onSaveFeedback ||
            (liked && liked.length > 0) ||
            (disliked && disliked.length > 0)) && (
            <div className="rounded-xl border border-amber/30 bg-amber/[0.04] px-5 py-4">
              <h3 className="mb-1.5 font-mono text-[0.66rem] uppercase tracking-[0.22em] text-amber">
                Debrief - tune the next call
              </h3>
              <p className="mb-3 font-mono text-[0.62rem] text-muted">
                {liked?.length || 0} cue{liked?.length === 1 ? "" : "s"} liked
                {"  \u00b7  "}
                {disliked?.length || 0} removed
              </p>
              {disliked && disliked.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1 font-mono text-[0.56rem] uppercase tracking-[0.18em] text-rust/80">
                    you removed
                  </p>
                  <ul className="space-y-1">
                    {disliked.slice(0, 8).map((d, i) => (
                      <li
                        key={i}
                        className="font-sans text-xs leading-snug text-bone/60 line-through"
                      >
                        {d.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <textarea
                value={debriefNotes}
                onChange={(e) => setDebriefNotes(e.target.value)}
                rows={3}
                placeholder="What worked, what to change next time - e.g. cues were too long, loved the redirects, stop probing budget so early"
                className="w-full resize-y rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60"
              />
              {onSaveFeedback && (
                <button
                  onClick={async () => {
                    await onSaveFeedback(debriefNotes);
                    setSavedFeedback(true);
                  }}
                  disabled={savedFeedback}
                  className="mt-2 rounded-full border border-amber/50 bg-amber/10 px-4 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:opacity-50"
                >
                  {savedFeedback ? "saved \u2713" : "save feedback"}
                </button>
              )}
            </div>
          )}

          {summary.styleProfile && (
            <div className="rounded-xl border border-edge bg-ink/40 px-5 py-4">
              <p className="mb-1 font-mono text-[0.6rem] uppercase tracking-[0.25em] text-muted">
                your style profile (for future cue matching)
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
