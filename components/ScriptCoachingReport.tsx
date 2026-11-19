"use client";
import type { ScriptCoachingReport as Report } from "@/lib/script-coaching-report";
export default function ScriptCoachingReport({
  report,
  sessionId,
  callId,
  ownerNote,
}: {
  report: Report;
  sessionId: string;
  callId?: string;
  ownerNote?: string | null;
}) {
  return (
    <div className="mt-4 space-y-4 text-sm text-bone/85">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-medium text-bone">{report.headline}</h3>
        <span className="rounded-full border border-sky/40 px-3 py-1 text-sky">
          {report.score == null
            ? "Intent-based review"
            : `${report.score}% script coverage`}
        </span>
      </div>
      <p>{report.intentOutcome}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 font-medium text-sage">What worked</h4>
          <ul className="list-disc space-y-2 pl-4">
            {report.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="mb-2 font-medium text-amber">Improve next time</h4>
          <ol className="list-decimal space-y-2 pl-4">
            {report.improvements.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      </div>
      <p className="rounded-xl border border-sage/30 bg-sage/10 p-3">
        <strong>Next-call priority:</strong> {report.nextCallFocus}
      </p>
      {report.switchReview && (
        <p className="text-muted">Product changes: {report.switchReview}</p>
      )}
      {report.criteria.map((c) => (
        <details
          key={`${c.product}:${c.stageId}`}
          className="rounded-lg border border-edge p-3"
        >
          <summary className="cursor-pointer">
            {c.stageId.replaceAll("_", " ")}{" "}
            <span className="ml-2 text-sky">
              {c.status.replaceAll("_", " ")}
            </span>
          </summary>
          <p className="mt-2">{c.explanation}</p>
          {c.evidenceQuote && (
            <blockquote className="my-2 border-l-2 border-sky pl-3 text-bone">
              “{c.evidenceQuote}”
            </blockquote>
          )}
          {c.betterNextTime && <p>Try: {c.betterNextTime}</p>}
          <a
            className="mt-2 inline-block text-sky underline"
            href={
              callId
                ? `/api/crm/call-coaching?callId=${encodeURIComponent(callId)}&transcript=1`
                : `/api/crm/calls/${encodeURIComponent(`session:${sessionId}`)}/transcript`
            }
            target="_blank"
            rel="noreferrer"
          >
            Open transcript evidence
          </a>
        </details>
      ))}
      {ownerNote && (
        <p className="rounded-lg border border-amber/30 p-3">
          <strong>Owner review / correction:</strong> {ownerNote}
        </p>
      )}
      <p className="text-xs text-muted">
        Advisory coaching. {report.limits.join(" ")} Saved script:{" "}
        {report.scriptVersion || "none"}. Generated{" "}
        {new Date(report.generatedAt).toLocaleString("en-GB")}.
      </p>
    </div>
  );
}
