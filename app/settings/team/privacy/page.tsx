"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import MatrixRain from "@/components/MatrixRain";
import NavMenu from "@/components/crm/NavMenu";
import { crmConfirmationError, crmFetch } from "@/lib/crm";

type SharingRecord = {
  id: string;
  name: string;
  sector: string | null;
  stage: string | null;
  updatedAt: string;
  confidential: boolean;
  shared: boolean;
  assignedToUserId: string | null;
  openOpportunityCount: number;
  blockedReason: string | null;
};

type TeamMember = {
  userId: string;
  role: string;
  name: string;
};

type SharingData = {
  records: SharingRecord[];
  team: TeamMember[];
  currentUser: string;
};

type PrivacyFilter = "all" | "attention" | "confidential" | "shared" | "owner";

const needsAttention = (record: SharingRecord) =>
  Boolean(record.blockedReason) && !record.confidential;

const privacyState = (
  record: SharingRecord
): Exclude<PrivacyFilter, "all"> => {
  if (needsAttention(record)) return "attention";
  if (record.confidential) return "confidential";
  if (record.shared) return "shared";
  return "owner";
};

const stateTone: Record<Exclude<PrivacyFilter, "all">, string> = {
  attention: "border-rust/55 bg-rust/10 text-rust",
  confidential: "border-amber/55 bg-amber/10 text-amber",
  shared: "border-sage/55 bg-sage/10 text-sage",
  owner: "border-edge bg-ink/45 text-muted",
};

export default function TeamPrivacyReviewPage() {
  const [data, setData] = useState<SharingData | null>(null);
  const [filter, setFilter] = useState<PrivacyFilter>("all");
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(50);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const next = await crmFetch<SharingData>("/api/crm/team/sharing");
      setData(next);
    } catch (loadError: any) {
      setError(loadError?.message || "The privacy review could not be loaded");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setVisibleLimit(50);
  }, [filter, query]);

  const counts = useMemo(() => {
    const records = data?.records || [];
    return {
      all: records.length,
      attention: records.filter(needsAttention).length,
      confidential: records.filter((record) => record.confidential).length,
      shared: records.filter((record) => record.shared && !needsAttention(record)).length,
      owner: records.filter(
        (record) =>
          !record.confidential && !record.shared && !needsAttention(record)
      ).length,
    };
  }, [data]);

  const records = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(data?.records || [])]
      .filter((record) => filter === "all" || privacyState(record) === filter)
      .filter((record) => {
        if (!needle) return true;
        return [record.name, record.sector, record.stage, record.blockedReason]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort(
        (a, b) =>
          Number(needsAttention(b)) - Number(needsAttention(a)) ||
          Number(b.confidential) - Number(a.confidential) ||
          Number(b.shared) - Number(a.shared) ||
          a.name.localeCompare(b.name)
      );
  }, [data, filter, query]);

  const memberName = (userId: string | null) =>
    data?.team.find((member) => member.userId === userId)?.name ||
    "Assigned salesperson";

  const visibleRecords = records.slice(0, visibleLimit);

  const lockRecord = async (record: SharingRecord) => {
    if (busyId) return;
    setBusyId(record.id);
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<{
        companyId: string;
        confidential: boolean;
        shared: boolean;
      }>("/api/crm/team/sharing", {
        method: "PATCH",
        body: JSON.stringify({ companyId: record.id, confidential: true }),
      });
      if (
        result.companyId !== record.id ||
        result.confidential !== true ||
        result.shared !== false
      ) {
        throw crmConfirmationError({
          url: "/api/crm/team/sharing",
          method: "PATCH",
          reason: `LiveCoach did not confirm the privacy lock for ${record.name}`,
        });
      }
      setNotice(
        `${record.name} is now confidential. Team access was removed and only Lee can open it.`
      );
      await load();
    } catch (saveError: any) {
      setError(saveError?.message || "That privacy lock did not save");
      await load();
    } finally {
      setBusyId("");
    }
  };

  const visibilityText = (record: SharingRecord) => {
    if (record.confidential) return "Lee only";
    if (needsAttention(record)) return "Lee only. Hard lock recommended";
    if (record.shared) return `Lee and ${memberName(record.assignedToUserId)}`;
    return "Lee only";
  };

  const brainText = (record: SharingRecord) => {
    if (record.confidential) {
      return "Lee's Brain can use this record. Every team member's Brain is blocked from it.";
    }
    if (needsAttention(record)) {
      return "The safety policy already blocks team sharing. A hard lock makes that protection explicit and persistent.";
    }
    if (record.shared) {
      return "The assigned salesperson's Brain can use only the safe shared client fields. Your calls, transcripts, email, calendar, notes, documents and private Brain memory stay hidden.";
    }
    return "This record stays in Lee's account and is invisible to sales users until it is deliberately shared.";
  };

  return (
    <main className="min-h-screen bg-ink px-3 py-4 text-bone sm:px-6 sm:py-6">
      <NavMenu />
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-rust">
              Owner only
            </p>
            <h1 className="mt-1 font-display text-2xl">Privacy review</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              Check every client access boundary without opening or copying private source material.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/settings/team/sharing"
              className="rounded-full border border-sage/45 px-4 py-2 font-mono text-[0.58rem] uppercase text-sage hover:bg-sage/10"
            >
              Sales work allocation
            </Link>
            <Link
              href="/settings/team"
              className="rounded-full border border-edge px-4 py-2 font-mono text-[0.58rem] uppercase text-muted hover:border-amber/50 hover:text-amber"
            >
              Back to team
            </Link>
          </div>
        </header>

        {error ? (
          <p role="alert" className="mb-4 rounded-xl border border-rust/50 bg-rust/10 px-4 py-3 text-sm text-rust">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="mb-4 rounded-xl border border-sage/50 bg-sage/10 px-4 py-3 text-sm text-sage">
            {notice}
          </p>
        ) : null}

        {!data ? (
          <MatrixRain
            size="panel"
            messages={["checking access boundaries", "confirming owner only records"]}
          />
        ) : (
          <>
            <section
              className={`rounded-2xl border p-4 sm:p-5 ${
                counts.attention
                  ? "border-rust/55 bg-rust/[0.07]"
                  : "border-sage/45 bg-sage/[0.06]"
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className={`font-mono text-[0.56rem] uppercase tracking-wider ${counts.attention ? "text-rust" : "text-sage"}`}>
                    {counts.attention ? "Review needed" : "All clear"}
                  </p>
                  <h2 className="mt-1 font-display text-xl text-bone">
                    {counts.attention
                      ? `${counts.attention} sensitive ${counts.attention === 1 ? "record needs" : "records need"} a hard lock`
                      : "Every sensitive record has an explicit privacy lock"}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
                    Lee can see everything. A salesperson sees only the safe client shell you deliberately share with them. Confidential records are invisible to team accounts and their Brain.
                  </p>
                </div>
                {counts.attention ? (
                  <button
                    type="button"
                    onClick={() => setFilter("attention")}
                    className="min-h-11 rounded-full border border-rust/60 bg-rust px-4 font-mono text-[0.58rem] uppercase text-ink"
                  >
                    Review now
                  </button>
                ) : null}
              </div>
            </section>

            <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ["attention", "Needs attention", counts.attention, "text-rust"],
                ["confidential", "Hard locked", counts.confidential, "text-amber"],
                ["shared", "Actively shared", counts.shared, "text-sage"],
                ["owner", "Owner only", counts.owner, "text-muted"],
              ] as const).map(([value, label, count, tone]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(filter === value ? "all" : value)}
                  className={`rounded-xl border p-3 text-left transition sm:p-4 ${
                    filter === value ? "border-amber/55 bg-amber/[0.07]" : "border-edge bg-panel/55"
                  }`}
                >
                  <span className={`block font-display text-xl sm:text-2xl ${tone}`}>{count}</span>
                  <span className="mt-1 block font-mono text-[0.48rem] uppercase text-muted sm:text-[0.56rem]">
                    {label}
                  </span>
                </button>
              ))}
            </section>

            <section className="mt-4 rounded-2xl border border-edge bg-panel/45 p-3 sm:p-4">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search client, stage or classification"
                  className="min-h-11 rounded-xl border border-edge bg-ink/60 px-4 text-sm text-bone outline-none focus:border-amber/60"
                />
                <button
                  type="button"
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                  }}
                  className="min-h-11 rounded-xl border border-edge px-4 font-mono text-[0.56rem] uppercase text-muted hover:border-amber/50 hover:text-amber"
                >
                  Show all {counts.all}
                </button>
              </div>

              <p className="mt-3 font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                Showing {records.length}. Records needing action appear first.
              </p>

              <div className="mt-2 space-y-2">
                {visibleRecords.map((record) => {
                  const state = privacyState(record);
                  return (
                    <article
                      key={record.id}
                      className={`rounded-xl border p-3 sm:p-4 ${
                        state === "attention"
                          ? "border-rust/45 bg-rust/[0.06]"
                          : "border-edge bg-ink/35"
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/crm/${record.id}`}
                              className="font-semibold text-bone hover:text-amber"
                            >
                              {record.name}
                            </Link>
                            <span className={`rounded-full border px-2 py-0.5 font-mono text-[0.47rem] uppercase ${stateTone[state]}`}>
                              {state === "attention"
                                ? "Needs hard lock"
                                : state === "confidential"
                                  ? "Confidential"
                                  : state === "shared"
                                    ? "Shared"
                                    : "Owner only"}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted">
                            {[record.stage || "Stage not set", record.sector, record.openOpportunityCount ? `${record.openOpportunityCount} open opportunity` : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {record.blockedReason ? (
                            <p className={`mt-2 text-xs ${state === "attention" ? "text-rust" : "text-amber"}`}>
                              {record.blockedReason}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-start gap-2 sm:items-end">
                          <div className="text-left sm:text-right">
                            <p className="font-mono text-[0.46rem] uppercase text-muted">Who can see it</p>
                            <p className={`mt-1 text-xs ${record.shared ? "text-sage" : "text-bone"}`}>
                              {visibilityText(record)}
                            </p>
                          </div>
                          {state === "attention" ? (
                            <button
                              type="button"
                              onClick={() => lockRecord(record)}
                              disabled={Boolean(busyId)}
                              className="min-h-10 rounded-full border border-rust/60 bg-rust px-4 font-mono text-[0.56rem] uppercase text-ink disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {busyId === record.id ? "Locking…" : "Lock now"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <details className="mt-3 border-t border-edge/70 pt-3">
                        <summary className="cursor-pointer font-mono text-[0.52rem] uppercase text-muted hover:text-amber">
                          Why this access is safe
                        </summary>
                        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted">
                          {brainText(record)}
                        </p>
                      </details>
                    </article>
                  );
                })}
                {!records.length ? (
                  <p className="rounded-xl border border-dashed border-edge p-6 text-center text-sm text-muted">
                    No client records match this view.
                  </p>
                ) : null}
                {records.length > visibleRecords.length ? (
                  <button
                    type="button"
                    onClick={() => setVisibleLimit((current) => current + 50)}
                    className="min-h-11 w-full rounded-xl border border-edge font-mono text-[0.56rem] uppercase text-muted hover:border-amber/50 hover:text-amber"
                  >
                    Show 50 more. {records.length - visibleRecords.length} remaining
                  </button>
                ) : null}
              </div>
            </section>

            <section className="mt-4 rounded-2xl border border-sage/35 bg-sage/[0.05] p-4 text-sm leading-relaxed text-muted">
              <p>
                Unlocking a confidential client never shares it. Sharing is always a separate deliberate action in Sales work allocation.
              </p>
              <p className="mt-2">
                This review reads the live CRM access state. It does not copy calls, email, transcripts, documents, private notes or Brain history into another database.
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
