"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch } from "@/lib/crm";

type Duplicate = {
  id: string;
  reason: string;
  records: { id: string; name: string; updatedAt: string | null }[];
};

type ReviewRecord = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  sector: string | null;
  stage: string | null;
  createdAt: string;
  updatedAt: string;
  hasNotes: boolean;
  hasEmailContext: boolean;
  hasBrainMemory: boolean;
  hasProfile: boolean;
  customFields: number;
  counts: Record<string, number>;
  linkedRecords: number;
};

type Preview = {
  reason: string;
  keep: ReviewRecord;
  merge: ReviewRecord;
};

const countLabels: Record<string, string> = {
  contacts: "Contacts",
  calls: "Calls",
  summaries: "Summaries",
  opportunities: "Opportunities",
  followUps: "Follow-ups",
  tasks: "Tasks",
  context: "Notes & context",
  brainMessages: "Brain history",
  upcomingCalls: "Upcoming calls",
  outreach: "Outreach links",
  emailLinks: "Email links",
  externalRefs: "External links",
  prioritySetting: "Priority setting",
};

function RecordSummary({ record, label }: { record: ReviewRecord; label: string }) {
  return (
    <div className="rounded-lg border border-edge bg-ink/45 p-3">
      <p className="font-mono text-[0.55rem] uppercase tracking-[0.16em] text-amber">
        {label}
      </p>
      <Link
        href={`/crm/${record.id}`}
        className="mt-1 block font-sans text-base font-medium text-bone underline decoration-edge underline-offset-2 hover:text-amber"
      >
        {record.name} ↗
      </Link>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-sans text-[0.72rem] text-bone/70">
        <dt className="text-muted">Stage</dt>
        <dd className="text-right">{record.stage || "Not set"}</dd>
        <dt className="text-muted">Website</dt>
        <dd className="truncate text-right">{record.domain || record.website || "Not set"}</dd>
        <dt className="text-muted">Sector</dt>
        <dd className="truncate text-right">{record.sector || "Not set"}</dd>
        <dt className="text-muted">Linked items</dt>
        <dd className="text-right font-medium text-bone">{record.linkedRecords}</dd>
      </dl>
      <div className="mt-2 flex flex-wrap gap-1">
        {record.hasNotes ? <Tag>notes</Tag> : null}
        {record.hasEmailContext ? <Tag>email context</Tag> : null}
        {record.hasBrainMemory ? <Tag>brain memory</Tag> : null}
        {record.hasProfile ? <Tag>profile</Tag> : null}
        {record.customFields ? <Tag>{record.customFields} custom fields</Tag> : null}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1">
        {Object.entries(record.counts)
          .filter(([, count]) => count > 0)
          .map(([key, count]) => (
            <span key={key} className="font-mono text-[0.56rem] text-muted">
              {countLabels[key] || key}: <span className="text-bone/80">{count}</span>
            </span>
          ))}
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-edge px-2 py-0.5 font-mono text-[0.5rem] uppercase tracking-wider text-bone/65">
      {children}
    </span>
  );
}

export default function DuplicateClients() {
  const [items, setItems] = useState<Duplicate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePair, setActivePair] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDuplicates = () => {
    setLoading(true);
    crmFetch<{ duplicates: Duplicate[] }>("/api/crm/duplicates")
      .then((data) => setItems(data.duplicates || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDuplicates();
  }, []);

  const review = async (pair: Duplicate, keepId: string) => {
    const mergeId = pair.records.find((record) => record.id !== keepId)?.id;
    if (!mergeId) return;
    setActivePair(pair.id);
    setPreview(null);
    setConfirmed(false);
    setError("");
    setNotice("");
    setReviewing(true);
    try {
      const data = await crmFetch<Preview>(
        `/api/crm/duplicates/merge?keepId=${encodeURIComponent(keepId)}&mergeId=${encodeURIComponent(mergeId)}`
      );
      setPreview(data);
    } catch (err: any) {
      setError(err?.message || "Could not prepare this review");
    } finally {
      setReviewing(false);
    }
  };

  const merge = async () => {
    if (!preview || !confirmed || merging) return;
    const accepted = window.confirm(
      `Keep “${preview.keep.name}” and merge “${preview.merge.name}” into it? All linked history will move to the kept record.`
    );
    if (!accepted) return;

    setMerging(true);
    setError("");
    try {
      await crmFetch("/api/crm/duplicates/merge", {
        method: "POST",
        body: JSON.stringify({
          keepId: preview.keep.id,
          mergeId: preview.merge.id,
          expectedKeepUpdatedAt: preview.keep.updatedAt,
          expectedMergeUpdatedAt: preview.merge.updatedAt,
          confirmed: true,
          confirmName: preview.keep.name,
        }),
      });
      setItems((current) => current.filter((item) => item.id !== activePair));
      setNotice(`Merged into ${preview.keep.name}. Every linked record was moved.`);
      setPreview(null);
      setConfirmed(false);
      setActivePair("");
      loadDuplicates();
    } catch (err: any) {
      setError(err?.message || "The merge did not complete. Nothing was changed.");
    } finally {
      setMerging(false);
    }
  };

  if (!loading && !items.length && !notice) return null;

  return (
    <div
      id="duplicates"
      className="mb-3 scroll-mt-4 rounded-xl border border-amber/45 bg-amber/[0.06] p-3 sm:p-4"
    >
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
        {"◇"} Possible duplicate clients · {items.length}
      </p>
      <p className="mt-1 font-sans text-[0.76rem] leading-snug text-bone/65">
        Review both records, choose which one to keep, then approve the merge. Nothing merges automatically.
      </p>

      {notice ? (
        <p className="mt-3 rounded-lg border border-sage/35 bg-sage/10 px-3 py-2 font-sans text-sm text-sage">
          ✓ {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-lg border border-rust/35 bg-rust/10 px-3 py-2 font-sans text-sm text-rust">
          {error}
        </p>
      ) : null}

      {loading && !items.length ? (
        <p className="mt-3 font-mono text-xs text-muted">checking…</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-edge bg-ink/35 p-3">
              <p className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
                Match: {item.reason}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {item.records.map((record) => (
                  <div key={record.id} className="rounded-lg border border-edge bg-ink/30 p-2.5">
                    <Link
                      href={`/crm/${record.id}`}
                      className="font-sans text-sm text-bone underline decoration-edge underline-offset-2 transition hover:text-amber"
                    >
                      {record.name} ↗
                    </Link>
                    <button
                      type="button"
                      onClick={() => review(item, record.id)}
                      disabled={reviewing && activePair === item.id}
                      className="mt-2 block w-full rounded-md border border-amber/45 px-2.5 py-2 font-mono text-[0.56rem] uppercase tracking-wider text-amber transition hover:bg-amber/10 disabled:opacity-50"
                    >
                      Keep this record
                    </button>
                  </div>
                ))}
              </div>

              {activePair === item.id && reviewing ? (
                <p className="mt-3 font-mono text-xs text-muted">building a safe review…</p>
              ) : null}

              {activePair === item.id && preview ? (
                <div className="mt-3 rounded-xl border border-amber/35 bg-black/15 p-3">
                  <p className="font-mono text-[0.57rem] uppercase tracking-[0.16em] text-amber">
                    Final review
                  </p>
                  <p className="mt-1 font-sans text-xs leading-relaxed text-bone/65">
                    The kept record’s filled-in details win. Empty fields are filled from the other record, and both records’ calls, contacts, tasks, notes, opportunities, email context, brain memory and outreach links are retained.
                  </p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <RecordSummary record={preview.keep} label="Keep" />
                    <RecordSummary record={preview.merge} label="Merge into kept record" />
                  </div>
                  <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-edge bg-ink/35 p-3">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                      className="mt-0.5 accent-amber"
                    />
                    <span className="font-sans text-xs leading-relaxed text-bone/75">
                      I have reviewed both records. Keep <strong className="text-bone">{preview.keep.name}</strong> and remove only the duplicate record after its full history has moved.
                    </span>
                  </label>
                  <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setPreview(null);
                        setActivePair("");
                        setConfirmed(false);
                      }}
                      className="rounded-lg border border-edge px-4 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-muted hover:text-bone"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={merge}
                      disabled={!confirmed || merging}
                      className="rounded-lg bg-amber px-4 py-2 font-mono text-[0.58rem] font-semibold uppercase tracking-wider text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {merging
                        ? "Merging safely…"
                        : `Merge ${preview.merge.name} into ${preview.keep.name}`}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
