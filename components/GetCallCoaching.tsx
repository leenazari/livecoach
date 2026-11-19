"use client";
import { useState } from "react";
import Link from "next/link";
import { crmFetch } from "@/lib/crm";
import ScriptCoachingReport from "@/components/ScriptCoachingReport";
import type { ScriptCoachingReport as Report } from "@/lib/script-coaching-report";
export default function GetCallCoaching({
  sessionId,
  callId,
}: {
  sessionId: string;
  callId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [reportCallId, setReportCallId] = useState(callId);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const data = await crmFetch<{
        ok: boolean;
        report: Report;
        callId?: string;
      }>("/api/crm/call-coaching", {
        method: "POST",
        body: JSON.stringify(callId ? { callId } : { sessionId }),
      });
      if (!data.ok) throw new Error("The coaching result was not confirmed");
      setReport(data.report);
      setReportCallId(data.callId || callId);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Coaching could not be confirmed",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="my-5 rounded-xl border border-sky/40 bg-panel p-5">
      <h2 className="text-lg text-bone">Call coaching</h2>
      <p className="my-2 text-sm text-muted">
        Review this call against its intent and the script active at the time.
        Analysis runs only when you press the button.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={generate}
        className="min-h-12 rounded-full bg-sky px-6 py-2 font-medium text-ink disabled:opacity-50"
      >
        {busy
          ? "Analysing this call…"
          : report
            ? "View saved coaching"
            : "Get coaching"}
      </button>
      <Link className="ml-4 text-sm text-sky underline" href="/crm/call-coach">
        All my call coaching
      </Link>
      {error && (
        <p role="alert" className="mt-3 text-sm text-rust">
          {error}
        </p>
      )}
      {report && (
        <ScriptCoachingReport
          report={report}
          sessionId={sessionId}
          callId={reportCallId}
        />
      )}
    </section>
  );
}
