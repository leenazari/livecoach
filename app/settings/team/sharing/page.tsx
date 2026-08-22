"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import MatrixRain from "@/components/MatrixRain";
import NavMenu from "@/components/crm/NavMenu";
import { crmFetch } from "@/lib/crm";

type SharingRecord = {
  id: string;
  name: string;
  sector: string | null;
  stage: string | null;
  updatedAt: string;
  shared: boolean;
  assignedToUserId: string | null;
  openOpportunityCount: number;
  blockedReason: string | null;
};

type TeamMember = { userId: string; role: string; name: string };

type SharingData = {
  records: SharingRecord[];
  summary: { total: number; shared: number; protected: number };
  team: TeamMember[];
  currentUser: string;
};

export default function TeamSharingPage() {
  const [data, setData] = useState<SharingData | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "shared" | "private">("all");
  const [busyId, setBusyId] = useState("");
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const next = await crmFetch<SharingData>("/api/crm/team/sharing");
      setData(next);
      setAssignmentDrafts(
        Object.fromEntries(
          (next.records || []).map((record) => [
            record.id,
            record.assignedToUserId || "",
          ])
        )
      );
    } catch (loadError: any) {
      setError(loadError?.message || "Client sharing could not be loaded");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.records || []).filter((record) => {
      if (filter === "shared" && !record.shared) return false;
      if (filter === "private" && record.shared) return false;
      if (!needle) return true;
      return [record.name, record.stage, record.sector]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [data, filter, query]);

  const changeSharing = async (
    record: SharingRecord,
    shared: boolean,
    assignedToUserId = assignmentDrafts[record.id] || ""
  ) => {
    const previousAssignee = record.assignedToUserId || "";
    if (shared && !assignedToUserId) {
      setError("Choose the salesperson responsible for this client");
      return;
    }
    setBusyId(record.id);
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<{
        companyId: string;
        shared: boolean;
        assignedToUserId: string | null;
        opportunitiesUpdated: number;
      }>(
        "/api/crm/team/sharing",
        {
          method: "PATCH",
          body: JSON.stringify({
            companyId: record.id,
            shared,
            assignedToUserId: shared ? assignedToUserId : null,
          }),
        }
      );
      if (
        result.companyId !== record.id ||
        result.shared !== shared ||
        (shared && result.assignedToUserId !== assignedToUserId)
      ) {
        throw new Error("The database did not confirm that access change");
      }
      setData((current) => {
        if (!current) return current;
        const wasShared = current.records.find((item) => item.id === record.id)?.shared;
        return {
          ...current,
          records: current.records.map((item) =>
            item.id === record.id
              ? {
                  ...item,
                  shared,
                  assignedToUserId: shared
                    ? result.assignedToUserId
                    : item.assignedToUserId,
                }
              : item
          ),
          summary: {
            ...current.summary,
            shared:
              current.summary.shared +
              (wasShared === shared ? 0 : shared ? 1 : -1),
          },
        };
      });
      if (shared) {
        const member = data?.team.find(
          (item) => item.userId === result.assignedToUserId
        );
        setAssignmentDrafts((current) => ({
          ...current,
          [record.id]: result.assignedToUserId || "",
        }));
        setNotice(
          `${record.name} is assigned to ${member?.name || "the selected salesperson"}. ${result.opportunitiesUpdated || 0} open revenue ${result.opportunitiesUpdated === 1 ? "deal is" : "deals are"} now in their My work view.`
        );
      } else {
        setNotice(`${record.name} is private again`);
      }
    } catch (saveError: any) {
      setAssignmentDrafts((current) => ({
        ...current,
        [record.id]: previousAssignee,
      }));
      setError(saveError?.message || "That access change did not save");
    } finally {
      setBusyId("");
    }
  };

  return (
    <main className="min-h-screen bg-ink px-3 py-4 text-bone sm:px-6 sm:py-6">
      <NavMenu />
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-sage">
              Owner control
            </p>
            <h1 className="mt-1 font-display text-2xl">Sales data sharing</h1>
          </div>
          <Link
            href="/settings/team"
            className="w-fit rounded-full border border-edge px-4 py-2 font-mono text-[0.6rem] uppercase text-muted hover:border-amber/50 hover:text-amber"
          >
            Back to team
          </Link>
        </header>

        <section className="rounded-2xl border border-sage/40 bg-sage/[0.06] p-4 sm:p-5">
          <h2 className="font-display text-lg">What sharing does</h2>
          <div className="mt-3 grid gap-3 text-sm leading-relaxed text-muted md:grid-cols-2">
            <p>
              A shared client has one responsible salesperson. Their open revenue deals appear in the same person’s My work view.
            </p>
            <p>
              Your call recordings, transcripts, calendar, mailbox context, personal notes, documents and Brain history remain private.
            </p>
          </div>
        </section>

        {error ? (
          <p role="alert" className="mt-4 rounded-xl border border-rust/50 bg-rust/10 px-4 py-3 text-sm text-rust">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="mt-4 rounded-xl border border-sage/50 bg-sage/10 px-4 py-3 text-sm text-sage">
            {notice}
          </p>
        ) : null}

        {!data ? (
          <div className="mt-5">
            <MatrixRain size="panel" messages={["checking private records", "building the safe sales list"]} />
          </div>
        ) : (
          <>
            <section className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
              {[
                ["All records", data.summary.total],
                ["Shared", data.summary.shared],
                ["Protected", data.summary.protected],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-edge bg-panel/55 p-3 sm:p-4">
                  <p className="font-display text-xl sm:text-2xl">{value}</p>
                  <p className="mt-1 font-mono text-[0.48rem] uppercase text-muted sm:text-[0.56rem]">{label}</p>
                </div>
              ))}
            </section>

            <section className="mt-5 rounded-2xl border border-edge bg-panel/45 p-3 sm:p-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search clients"
                  className="min-h-11 rounded-xl border border-edge bg-ink/60 px-4 text-sm outline-none focus:border-amber/60"
                />
                <div className="flex rounded-xl border border-edge bg-ink/60 p-1">
                  {(["all", "shared", "private"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFilter(value)}
                      className={`min-h-9 flex-1 rounded-lg px-3 font-mono text-[0.56rem] uppercase sm:flex-none ${
                        filter === value ? "bg-amber/20 text-amber" : "text-muted"
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {shown.map((record) => (
                  <article
                    key={record.id}
                    className="flex flex-col gap-3 rounded-xl border border-edge bg-ink/35 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <Link href={`/crm/${record.id}`} className="font-semibold hover:text-amber">
                        {record.name}
                      </Link>
                      <p className="mt-1 text-xs text-muted">
                        {[record.stage || "Stage not set", record.sector, record.openOpportunityCount ? `${record.openOpportunityCount} open opportunity` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {record.blockedReason ? (
                        <p className="mt-1 text-xs text-rust">{record.blockedReason}</p>
                      ) : record.shared ? (
                        <p className="mt-1 text-xs text-sage">
                          Safe sales view shared with {data.team.find((member) => member.userId === record.assignedToUserId)?.name || "one salesperson"}. Private source material is still hidden.
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-muted">Owner only</p>
                      )}
                    </div>
                    <div className="grid shrink-0 gap-2 sm:min-w-[290px] sm:grid-cols-[minmax(0,1fr)_auto]">
                      <select
                        aria-label={`Responsible salesperson for ${record.name}`}
                        value={assignmentDrafts[record.id] || ""}
                        disabled={busyId === record.id || !!record.blockedReason}
                        onChange={(event) => {
                          const nextAssignee = event.target.value;
                          setAssignmentDrafts((current) => ({
                            ...current,
                            [record.id]: nextAssignee,
                          }));
                          if (record.shared && nextAssignee) {
                            void changeSharing(record, true, nextAssignee);
                          }
                        }}
                        className="min-h-10 rounded-xl border border-edge bg-ink/60 px-3 text-sm text-bone outline-none focus:border-amber/60 disabled:opacity-40"
                      >
                        <option value="">Choose salesperson</option>
                        {data.team.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.name}{member.userId === data.currentUser ? " · you" : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={
                          busyId === record.id ||
                          !!record.blockedReason ||
                          (!record.shared && !assignmentDrafts[record.id])
                        }
                        onClick={() => changeSharing(record, !record.shared)}
                        className={`min-h-10 rounded-full border px-4 font-mono text-[0.58rem] uppercase disabled:cursor-not-allowed disabled:opacity-35 ${
                          record.shared
                            ? "border-rust/45 bg-rust/10 text-rust"
                            : "border-amber/50 bg-amber/10 text-amber"
                        }`}
                      >
                        {busyId === record.id
                          ? "Saving…"
                          : record.shared
                            ? "Make private"
                            : "Share"}
                      </button>
                    </div>
                  </article>
                ))}
                {!shown.length ? (
                  <p className="rounded-xl border border-dashed border-edge p-6 text-center text-sm text-muted">
                    No client records match this view.
                  </p>
                ) : null}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
