"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch } from "@/lib/crm";
import type {
  CallActionPlan,
  PreparedCallAction,
} from "@/lib/call-action-plan";
type Data = {
  callId: string;
  state: string;
  error: string | null;
  plan: CallActionPlan | null;
};
export default function CallActionPack({
  callId,
  sessionId,
}: {
  callId?: string;
  sessionId?: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const query = new URLSearchParams(
    callId ? { callId } : { sessionId: sessionId || "" },
  ).toString();
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let polls = 0;
    setData(null);
    setError("");
    const load = async () => {
      try {
        const next = await crmFetch<Data>(`/api/crm/call-actions?${query}`);
        if (cancelled) return;
        setData(next);
        if (["pending", "preparing"].includes(next.state) && polls++ < 40)
          timer = setTimeout(load, 3000);
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Action pack could not load",
          );
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, version]);
  async function retry() {
    setBusy(true);
    setError("");
    try {
      const result = await crmFetch<{ ok: boolean }>("/api/crm/call-actions", {
        method: "POST",
        body: JSON.stringify(callId ? { callId } : { sessionId }),
      });
      if (!result.ok) throw new Error("Preparation was not confirmed");
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preparation not confirmed");
    } finally {
      setBusy(false);
    }
  }
  async function copy(action: PreparedCallAction) {
    try {
      await navigator.clipboard.writeText(
        [
          action.subject,
          action.body,
          action.coverEmailSubject,
          action.coverEmailBody,
          ...action.missingDetails.map((s) => `To confirm: ${s}`),
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
      setCopied(action.id);
    } catch {
      setError("Copy was unavailable. Select the draft text below to copy it.");
    }
  }
  const working = data && ["pending", "preparing"].includes(data.state);
  return (
    <section
      className="my-5 rounded-xl border border-sage/40 bg-panel p-5"
      aria-label="Prepared call actions"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg text-bone">Your next actions, prepared</h2>
        <Link className="text-sm text-sky underline" href="/crm/tasks">
          Open my Tasks
        </Link>
      </div>
      <p className="mt-2 text-sm text-muted">
        Agreed work becomes tracked tasks with drafts ready to review. Prepared
        does not mean sent, booked or completed.
      </p>
      {((!data && !error) || working) && (
        <p role="status" className="mt-3 text-sm text-sky">
          Preparing the action pack automatically. You can leave this screen and
          return later.
        </p>
      )}
      {(error || data?.error) && (
        <p role="alert" className="mt-3 text-sm text-rust">
          {error || data?.error}
        </p>
      )}
      {data?.plan?.warnings?.map((w) => (
        <p key={w} className="mt-3 text-sm text-amber">
          {w}
        </p>
      ))}
      {data?.state === "ready" && !data.plan?.actions.length && (
        <p className="mt-3 text-sm text-muted">
          No verified follow-up commitments were found. Nothing was invented or
          sent.
        </p>
      )}
      <div className="mt-4 space-y-3">
        {data?.plan?.actions.map((action) => (
          <article
            key={action.id}
            className="rounded-lg border border-edge p-3"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-medium text-bone">{action.text}</h3>
              <span className="text-xs text-sage">
                {action.ownerType === "counterparty"
                  ? "Waiting on them"
                  : action.ownerType === "unassigned"
                    ? "Owner needs confirmation"
                    : data.state === "ready"
                      ? "Draft prepared · task saved"
                      : "Draft prepared · check save status"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {action.ownerName} ·{" "}
              {action.dueAt
                ? `Agreed deadline: ${new Date(action.dueAt).toLocaleString("en-GB")}`
                : "No agreed deadline"}{" "}
              · {action.kind}
            </p>
            {action.missingDetails.length > 0 && (
              <ul className="my-2 list-disc pl-4 text-sm text-amber">
                {action.missingDetails.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
            <details className="mt-3" open={action.ownerType === "me"}>
              <summary className="cursor-pointer text-sm text-sky">
                Review prepared content and evidence
              </summary>
              {action.subject && (
                <p className="mt-3 font-medium text-bone">{action.subject}</p>
              )}
              <p className="mt-2 whitespace-pre-wrap text-sm text-bone/85">
                {action.body}
              </p>
              {action.coverEmailBody && (
                <div className="mt-3 border-t border-edge pt-3">
                  <p className="font-medium text-bone">
                    Covering email: {action.coverEmailSubject}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-bone/85">
                    {action.coverEmailBody}
                  </p>
                </div>
              )}
              {action.coverEmailBody && (
                <div className="mt-3 border-t border-edge pt-3">
                  <p className="font-medium text-bone">
                    Covering email draft: {action.coverEmailSubject}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-bone/85">
                    {action.coverEmailBody}
                  </p>
                </div>
              )}
              <blockquote className="mt-3 border-l-2 border-edge pl-3 text-xs text-muted">
                Call evidence: “{action.sourceQuote}”
              </blockquote>
            </details>
            <div className="mt-3 flex gap-4">
              {action.body && (
                <button
                  type="button"
                  onClick={() => copy(action)}
                  className="text-sm text-sky underline"
                >
                  {copied === action.id ? "Copied" : "Copy draft"}
                </button>
              )}
              {action.body && (
                <a
                  className="text-sm text-sky underline"
                  href={`/api/crm/call-actions?callId=${data.callId}&actionId=${action.id}&download=1`}
                >
                  Download Word draft
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
      {data?.plan?.nextCallFocus && (
        <p className="mt-4 text-sm text-sage">
          <strong>Next conversation:</strong> {data.plan.nextCallFocus}
        </p>
      )}
      <div className="mt-4 flex gap-4">
        {(error ||
          data?.state === "error" ||
          data?.state === "not_started") && (
          <button
            type="button"
            disabled={busy}
            onClick={retry}
            className="text-sm text-sky underline"
          >
            {busy ? "Queueing…" : "Prepare or recover actions"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setVersion((v) => v + 1)}
          className="text-sm text-muted underline"
        >
          Refresh saved actions
        </button>
      </div>
    </section>
  );
}
