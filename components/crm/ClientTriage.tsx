"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { crmFetch } from "@/lib/crm";
import type { ClientPortfolioRow } from "@/components/crm/ClientPortfolio";
import { capitaliseSentenceStarts } from "@/lib/text";

type Classification =
  | "prospect"
  | "partner"
  | "customer"
  | "product_trial"
  | "in_house"
  | "irrelevant";

type Draft = {
  id: string;
  classification: Classification;
  nextAction: string;
};

const labels: Record<Classification, string> = {
  prospect: "Prospect",
  partner: "Partner",
  customer: "Customer",
  product_trial: "Product trial",
  in_house: "In house",
  irrelevant: "Archive as irrelevant",
};

const suggestedClassification = (row: ClientPortfolioRow): Classification => {
  const stage = String(row.relationshipStage || "").toLowerCase();
  if (stage === "in house") return "in_house";
  if (stage === "partner") return "partner";
  if (stage === "customer") return "customer";
  if (stage === "product trial") return "product_trial";
  return "prospect";
};

const suggestedAction = (row: ClientPortfolioRow) => {
  if (row.nextAction) return row.nextAction;
  if (row.nextMeetingAt)
    return `Prepare the next conversation with ${row.name} around a specific outcome`;
  if (!row.primaryContact)
    return `Identify the right contact at ${row.name} and confirm whether the relationship is still relevant`;
  if (row.daysQuiet != null && row.daysQuiet >= 21)
    return `Re-engage ${row.primaryContact.name} and confirm whether there is a live need`;
  return `Agree one concrete commercial next step with ${row.primaryContact?.name || row.name}`;
};

const evidence = (row: ClientPortfolioRow) => {
  if (row.opportunity) return `Open opportunity: ${row.opportunity.title}`;
  if (row.buyingSignal) return capitaliseSentenceStarts(row.buyingSignal);
  if (row.nextMeetingAt) return "A future meeting is already linked";
  if (row.primaryContact)
    return `${row.primaryContact.name} is saved${row.daysQuiet != null ? ` · ${row.daysQuiet} days since meaningful activity` : ""}`;
  return "No reliable contact or commercial evidence is saved yet";
};

export default function ClientTriage({
  clients,
  onSaved,
}: {
  clients: ClientPortfolioRow[];
  onSaved: () => Promise<void> | void;
}) {
  const queue = useMemo(
    () =>
      clients
        .filter(
          (row) =>
            !row.triageReviewedAt &&
            !row.archived &&
            row.health === "grey" &&
            !row.opportunity &&
            String(row.relationshipStage || "").toLowerCase() !== "dormant"
        )
        .sort((a, b) => {
          const aEvidence = Number(!!a.opportunity) * 4 + Number(!!a.primaryContact) * 2 + Number(!!a.lastTouchAt);
          const bEvidence = Number(!!b.opportunity) * 4 + Number(!!b.primaryContact) * 2 + Number(!!b.lastTouchAt);
          return bEvidence - aEvidence || a.name.localeCompare(b.name);
        }),
    [clients]
  );
  const batch = queue.slice(0, 5);
  const batchKey = batch.map((row) => row.id).join(":");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftBatchKey, setDraftBatchKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setDrafts(
      batch.map((row) => ({
        id: row.id,
        classification: suggestedClassification(row),
        nextAction: suggestedAction(row),
      }))
    );
    setDraftBatchKey(batchKey);
  }, [batchKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!queue.length && !notice) return null;

  const changeDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft))
    );

  const approve = async () => {
    if (
      !drafts.length ||
      saving ||
      draftBatchKey !== batchKey ||
      drafts.length !== batch.length
    )
      return;
    const archivedNames = drafts
      .filter((draft) => draft.classification === "irrelevant")
      .map((draft) => batch.find((row) => row.id === draft.id)?.name)
      .filter(Boolean);
    if (
      archivedNames.length &&
      !window.confirm(
        `Archive ${archivedNames.join(", ")}? Their history will remain, but open reminders will be dismissed.`
      )
    )
      return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<{ results: any[] }>("/api/crm/triage", {
        method: "POST",
        body: JSON.stringify({ items: drafts }),
      });
      setNotice(`${result.results.length} clients saved. The next five are ready.`);
      await onSaved();
    } catch (err: any) {
      setError(err?.message || "That triage batch did not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-4 rounded-2xl border border-sky/40 bg-sky/[0.055] p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sky">
            {"◎"} Five-minute client triage
          </p>
          <p className="mt-1 font-sans text-[0.76rem] leading-snug text-bone/65">
            Review five at a time. Suggestions reuse saved CRM facts and cost no AI tokens.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="shrink-0 rounded-full border border-sky/35 px-3 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-sky"
        >
          {open ? "Hide" : `${queue.length} to review`}
        </button>
      </div>

      {notice ? <p className="mt-3 rounded-lg border border-sage/35 bg-sage/10 px-3 py-2 text-sm text-sage">✓ {notice}</p> : null}
      {error ? <p role="alert" className="mt-3 rounded-lg border border-rust/40 bg-rust/10 px-3 py-2 text-sm text-rust">{error}</p> : null}

      {open && batch.length ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {batch.map((row) => {
              const draft = drafts.find((item) => item.id === row.id);
              if (!draft) return null;
              return (
                <article key={row.id} className="flex min-w-0 flex-col rounded-xl border border-edge bg-ink/45 p-3">
                  <Link href={`/crm/${row.id}`} className="truncate font-sans text-[0.86rem] font-medium text-bone hover:text-amber">
                    {row.name} ↗
                  </Link>
                  <p className="mt-1 line-clamp-2 min-h-8 font-sans text-[0.68rem] leading-snug text-muted">
                    {evidence(row)}
                  </p>
                  <label className="mt-3 font-mono text-[0.48rem] uppercase tracking-wider text-sky">
                    Relationship
                    <select
                      value={draft.classification}
                      onChange={(event) =>
                        changeDraft(row.id, {
                          classification: event.target.value as Classification,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-edge bg-ink px-2 py-2 font-sans text-[0.76rem] normal-case tracking-normal text-bone outline-none focus:border-sky/60"
                    >
                      {(Object.keys(labels) as Classification[]).map((key) => (
                        <option key={key} value={key}>{labels[key]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="mt-2 font-mono text-[0.48rem] uppercase tracking-wider text-amber">
                    Next move
                    <textarea
                      value={draft.nextAction}
                      disabled={draft.classification === "irrelevant"}
                      onChange={(event) => changeDraft(row.id, { nextAction: event.target.value })}
                      rows={3}
                      className="mt-1 w-full resize-none rounded-lg border border-edge bg-ink px-2 py-2 font-sans text-[0.72rem] normal-case leading-snug tracking-normal text-bone outline-none focus:border-amber/60 disabled:opacity-35"
                    />
                  </label>
                </article>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
              Showing {batch.length} of {queue.length} still to review
            </p>
            <button
              type="button"
              onClick={approve}
              disabled={
                saving ||
                draftBatchKey !== batchKey ||
                drafts.length !== batch.length
              }
              className="min-h-11 rounded-full border border-sky/50 bg-sky/10 px-5 font-mono text-[0.58rem] uppercase tracking-wider text-sky transition hover:bg-sky/20 disabled:opacity-40"
            >
              {saving ? "Saving…" : `Approve these ${batch.length}`}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
