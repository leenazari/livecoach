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
  confidential: boolean;
  shared: boolean;
  assignedToUserId: string | null;
  openOpportunityCount: number;
  blockedReason: string | null;
};

type ProspectRecord = {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  companyName: string;
  priority: "high" | "medium" | "low";
  priorityScore: number;
  status: string;
  assignedToUserId: string | null;
  source: string | null;
  updatedAt: string;
  assignable: boolean;
  blockedReason: string | null;
};

type TeamMember = {
  userId: string;
  role: string;
  name: string;
  workload: { prospects: number; clients: number; opportunities: number };
};

type SharingData = {
  records: SharingRecord[];
  prospects: ProspectRecord[];
  summary: {
    total: number;
    shared: number;
    confidential: number;
    protected: number;
    outreachTotal: number;
    outreachAssignable: number;
    outreachInProgress: number;
  };
  team: TeamMember[];
  currentUser: string;
};

const priorityTone = {
  high: "border-rust/45 bg-rust/10 text-rust",
  medium: "border-amber/45 bg-amber/10 text-amber",
  low: "border-edge bg-ink/40 text-muted",
} as const;

export default function TeamSharingPage() {
  const [data, setData] = useState<SharingData | null>(null);
  const [tab, setTab] = useState<"outreach" | "clients">("outreach");
  const [query, setQuery] = useState("");
  const [clientFilter, setClientFilter] = useState<
    "all" | "shared" | "private" | "confidential"
  >("all");
  const [prospectFilter, setProspectFilter] = useState("ready");
  const [busyId, setBusyId] = useState("");
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, string>>({});
  const [selectedProspects, setSelectedProspects] = useState<string[]>([]);
  const [bulkAssignee, setBulkAssignee] = useState("");
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
      setSelectedProspects([]);
    } catch (loadError: any) {
      setError(loadError?.message || "Sales work allocation could not be loaded");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shownClients = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.records || []).filter((record) => {
      if (clientFilter === "shared" && !record.shared) return false;
      if (clientFilter === "private" && record.shared) return false;
      if (clientFilter === "confidential" && !record.confidential) return false;
      if (!needle) return true;
      return [record.name, record.stage, record.sector]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [clientFilter, data, query]);

  const shownProspects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.prospects || []).filter((prospect) => {
      if (prospectFilter === "ready" && !prospect.assignable) return false;
      if (
        !["all", "ready"].includes(prospectFilter) &&
        prospect.assignedToUserId !== prospectFilter
      )
        return false;
      if (!needle) return true;
      return [
        prospect.name,
        prospect.companyName,
        prospect.jobTitle,
        prospect.email,
        prospect.source,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [data, prospectFilter, query]);

  const selectableProspects = useMemo(
    () =>
      shownProspects.filter(
        (prospect) =>
          prospect.assignable && prospect.assignedToUserId !== bulkAssignee
      ),
    [bulkAssignee, shownProspects]
  );

  const selectedSet = useMemo(
    () => new Set(selectedProspects),
    [selectedProspects]
  );
  const selectedAssignableIds = useMemo(
    () =>
      selectedProspects.filter((id) =>
        selectableProspects.some((prospect) => prospect.id === id)
      ),
    [selectableProspects, selectedProspects]
  );

  const memberName = (userId: string | null) =>
    data?.team.find((member) => member.userId === userId)?.name || "Unassigned";

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
      }>("/api/crm/team/sharing", {
        method: "PATCH",
        body: JSON.stringify({
          companyId: record.id,
          shared,
          assignedToUserId: shared ? assignedToUserId : null,
        }),
      });
      if (
        result.companyId !== record.id ||
        result.shared !== shared ||
        (shared && result.assignedToUserId !== assignedToUserId)
      ) {
        throw new Error("The database did not confirm that access change");
      }
      if (shared) {
        setNotice(
          `${record.name} is assigned to ${memberName(result.assignedToUserId)}. ${result.opportunitiesUpdated || 0} open revenue ${result.opportunitiesUpdated === 1 ? "deal is" : "deals are"} now in their My work view.`
        );
      } else {
        setNotice(`${record.name} is private again`);
      }
      await load();
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

  const changeConfidentiality = async (
    record: SharingRecord,
    confidential: boolean
  ) => {
    setBusyId(record.id);
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<{
        companyId: string;
        confidential: boolean;
        shared: boolean;
        opportunitiesUpdated: number;
      }>("/api/crm/team/sharing", {
        method: "PATCH",
        body: JSON.stringify({
          companyId: record.id,
          confidential,
        }),
      });
      if (
        result.companyId !== record.id ||
        result.confidential !== confidential ||
        (confidential && result.shared)
      ) {
        throw new Error("The database did not confirm the privacy lock");
      }
      if (confidential) {
        setNotice(
          `${record.name} is confidential and owner only. Any team access was removed.`
        );
      } else {
        setNotice(
          `${record.name} is unlocked but still private until you deliberately share it.`
        );
      }
      await load();
    } catch (saveError: any) {
      setError(saveError?.message || "That privacy change did not save");
      await load();
    } finally {
      setBusyId("");
    }
  };

  const toggleProspect = (prospectId: string) => {
    setSelectedProspects((current) =>
      current.includes(prospectId)
        ? current.filter((id) => id !== prospectId)
        : [...current, prospectId]
    );
  };

  const toggleVisibleProspects = () => {
    const ids = selectableProspects.map((prospect) => prospect.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedSet.has(id));
    setSelectedProspects((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return [...next];
    });
  };

  const assignSelectedProspects = async () => {
    const ids = selectedAssignableIds;
    if (!bulkAssignee || !ids.length) return;
    setBusyId("prospects");
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<{
        requested: number;
        assigned: number;
        skipped: number;
      }>("/api/crm/outreach/assign", {
        method: "POST",
        body: JSON.stringify({
          assignedToUserId: bulkAssignee,
          prospectIds: ids,
        }),
      });
      const name = memberName(bulkAssignee);
      setNotice(
        result.skipped
          ? `${result.assigned} prospects assigned to ${name}. ${result.skipped} were safely skipped because activity had started or the record changed.`
          : `${result.assigned} prospects assigned to ${name}. Nothing was researched or emailed.`
      );
      await load();
    } catch (saveError: any) {
      setError(saveError?.message || "The selected prospects were not assigned");
      await load();
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
            <h1 className="mt-1 font-display text-2xl">Sales work allocation</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              Give each salesperson clear work without opening your private calls, email, calendar or Brain history.
            </p>
          </div>
          <Link
            href="/settings/team"
            className="w-fit rounded-full border border-edge px-4 py-2 font-mono text-[0.6rem] uppercase text-muted hover:border-amber/50 hover:text-amber"
          >
            Back to team
          </Link>
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
          <MatrixRain size="panel" messages={["checking private records", "building the safe sales list"]} />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              {[
                ["Ready to allocate", data.summary.outreachAssignable, "text-amber"],
                ["Outreach active", data.summary.outreachInProgress, "text-sky"],
                ["Shared clients", data.summary.shared, "text-sage"],
                ["Protected records", data.summary.protected, "text-rust"],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="rounded-xl border border-edge bg-panel/55 p-3 sm:p-4">
                  <p className={`font-display text-xl sm:text-2xl ${tone}`}>{value}</p>
                  <p className="mt-1 font-mono text-[0.48rem] uppercase text-muted sm:text-[0.56rem]">{label}</p>
                </div>
              ))}
            </section>

            <section className="mt-4 rounded-2xl border border-edge bg-panel/40 p-3 sm:p-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="font-mono text-[0.54rem] uppercase tracking-wider text-amber">Team workload</p>
                  <h2 className="mt-1 font-display text-lg">Who owns what</h2>
                </div>
                <p className="text-xs text-muted">Counts come from the live CRM, not a separate report.</p>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.team.map((member) => (
                  <article key={member.userId} className="rounded-xl border border-edge bg-ink/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <strong className="truncate text-sm text-bone">{member.name}</strong>
                      <span className="rounded-full border border-edge px-2 py-1 font-mono text-[0.48rem] uppercase text-muted">{member.role}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      {[
                        ["Prospects", member.workload.prospects],
                        ["Clients", member.workload.clients],
                        ["Deals", member.workload.opportunities],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="rounded-lg border border-edge/70 bg-panel/35 p-2">
                          <strong className="block font-display text-lg text-bone">{value}</strong>
                          <span className="font-mono text-[0.44rem] uppercase text-muted">{label}</span>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="mt-4 rounded-2xl border border-sage/35 bg-sage/[0.05] p-3 text-sm leading-relaxed text-muted sm:p-4">
              <p>
                Imported outreach is shared sales inventory, but only its assigned salesperson can research or send to it. Client records stay private until you deliberately share them below.
              </p>
              <p className="mt-2">
                Call recordings, transcripts, calendar, mailbox context, personal notes, documents and owner Brain memory never move with an assignment.
              </p>
            </section>

            <div className="mt-4 flex rounded-xl border border-edge bg-panel/45 p-1">
              {([
                ["outreach", `Outreach allocation · ${data.summary.outreachAssignable}`],
                ["clients", `Client sharing · ${data.summary.shared}`],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setTab(value);
                    setQuery("");
                  }}
                  className={`min-h-10 flex-1 rounded-lg px-3 font-mono text-[0.54rem] uppercase sm:text-[0.6rem] ${
                    tab === value ? "bg-amber/20 text-amber" : "text-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "outreach" ? (
              <section className="mt-3 rounded-2xl border border-edge bg-panel/45 p-3 sm:p-4">
                <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_190px]">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search person, company, email or source"
                    className="min-h-11 rounded-xl border border-edge bg-ink/60 px-4 text-sm outline-none focus:border-amber/60"
                  />
                  <select
                    aria-label="Filter outreach by owner"
                    value={prospectFilter}
                    onChange={(event) => setProspectFilter(event.target.value)}
                    className="min-h-11 rounded-xl border border-edge bg-ink/60 px-3 text-sm text-bone outline-none focus:border-amber/60"
                  >
                    <option value="ready">Ready to allocate</option>
                    <option value="all">All outreach</option>
                    {data.team.map((member) => (
                      <option key={member.userId} value={member.userId}>{member.name}</option>
                    ))}
                  </select>
                </div>

                <div className="mt-3 grid gap-2 rounded-xl border border-amber/35 bg-amber/[0.05] p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                  <button
                    type="button"
                    onClick={toggleVisibleProspects}
                    disabled={!selectableProspects.length}
                    className="min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.55rem] uppercase text-muted disabled:opacity-35"
                  >
                    {selectableProspects.length > 0 && selectableProspects.every((prospect) => selectedSet.has(prospect.id)) ? "Clear visible" : "Select visible"}
                  </button>
                  <select
                    aria-label="Salesperson for selected prospects"
                    value={bulkAssignee}
                    onChange={(event) => setBulkAssignee(event.target.value)}
                    className="min-h-10 rounded-lg border border-edge bg-ink/70 px-3 text-sm text-bone outline-none focus:border-amber/60"
                  >
                    <option value="">Choose salesperson</option>
                    {data.team.map((member) => (
                      <option key={member.userId} value={member.userId}>{member.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={assignSelectedProspects}
                    disabled={busyId === "prospects" || !bulkAssignee || !selectedAssignableIds.length}
                    className="min-h-10 rounded-lg border border-amber/55 bg-amber/15 px-4 font-mono text-[0.55rem] uppercase text-amber disabled:opacity-35"
                  >
                    {busyId === "prospects" ? "Assigning…" : `Assign ${selectedAssignableIds.length || "selected"}`}
                  </button>
                </div>

                <p className="mt-3 font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                  Showing {shownProspects.length} · assignment never researches or sends an email
                </p>
                <div className="mt-2 space-y-2">
                  {shownProspects.map((prospect) => {
                    const selected = selectedSet.has(prospect.id);
                    return (
                      <article key={prospect.id} className={`grid gap-3 rounded-xl border p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center ${selected ? "border-amber/55 bg-amber/[0.07]" : "border-edge bg-ink/35"}`}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${prospect.name}`}
                          checked={selected}
                          disabled={!prospect.assignable}
                          onChange={() => toggleProspect(prospect.id)}
                          className="h-5 w-5 accent-amber disabled:opacity-30"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="truncate text-sm text-bone">{prospect.name}</strong>
                            <span className={`rounded-full border px-2 py-0.5 font-mono text-[0.47rem] uppercase ${priorityTone[prospect.priority]}`}>{prospect.priority}</span>
                            {prospect.source ? <span className="max-w-full truncate rounded-full border border-sky/35 bg-sky/10 px-2 py-0.5 font-mono text-[0.47rem] uppercase text-sky">{prospect.source}</span> : null}
                          </div>
                          <p className="mt-1 truncate text-xs text-muted">
                            {[prospect.jobTitle, prospect.companyName, prospect.email].filter(Boolean).join(" · ")}
                          </p>
                          {!prospect.assignable && prospect.blockedReason ? <p className="mt-1 text-xs text-amber">{prospect.blockedReason}</p> : null}
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="font-mono text-[0.46rem] uppercase text-muted">Sales owner</p>
                          <p className={`mt-1 text-xs ${prospect.assignedToUserId ? "text-sage" : "text-amber"}`}>{memberName(prospect.assignedToUserId)}</p>
                        </div>
                      </article>
                    );
                  })}
                  {!shownProspects.length ? (
                    <p className="rounded-xl border border-dashed border-edge p-6 text-center text-sm text-muted">
                      No outreach records match this view.
                    </p>
                  ) : null}
                </div>
              </section>
            ) : (
              <section className="mt-3 rounded-2xl border border-edge bg-panel/45 p-3 sm:p-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search clients"
                    className="min-h-11 rounded-xl border border-edge bg-ink/60 px-4 text-sm outline-none focus:border-amber/60"
                  />
                  <div className="flex rounded-xl border border-edge bg-ink/60 p-1">
                    {(["all", "shared", "private", "confidential"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setClientFilter(value)}
                        className={`min-h-9 flex-1 rounded-lg px-3 font-mono text-[0.56rem] uppercase sm:flex-none ${clientFilter === value ? "bg-amber/20 text-amber" : "text-muted"}`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {shownClients.map((record) => (
                    <article key={record.id} className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${record.confidential ? "border-rust/45 bg-rust/[0.07]" : "border-edge bg-ink/35"}`}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/crm/${record.id}`} className="font-semibold hover:text-amber">{record.name}</Link>
                          {record.confidential ? (
                            <span className="rounded-full border border-rust/50 bg-rust/10 px-2 py-0.5 font-mono text-[0.47rem] uppercase text-rust">Confidential</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {[record.stage || "Stage not set", record.sector, record.openOpportunityCount ? `${record.openOpportunityCount} open opportunity` : null].filter(Boolean).join(" · ")}
                        </p>
                        {record.blockedReason ? (
                          <p className="mt-1 text-xs text-rust">{record.blockedReason}</p>
                        ) : record.shared ? (
                          <p className="mt-1 text-xs text-sage">Safe sales view shared with {memberName(record.assignedToUserId)}. Private source material is still hidden.</p>
                        ) : (
                          <p className="mt-1 text-xs text-muted">Owner only</p>
                        )}
                      </div>
                      <div className="grid shrink-0 gap-2 sm:min-w-[390px] sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                        <select
                          aria-label={`Responsible salesperson for ${record.name}`}
                          value={assignmentDrafts[record.id] || ""}
                          disabled={busyId === record.id || !!record.blockedReason || record.confidential}
                          onChange={(event) => {
                            const nextAssignee = event.target.value;
                            setAssignmentDrafts((current) => ({ ...current, [record.id]: nextAssignee }));
                            if (record.shared && nextAssignee) void changeSharing(record, true, nextAssignee);
                          }}
                          className="min-h-10 rounded-xl border border-edge bg-ink/60 px-3 text-sm text-bone outline-none focus:border-amber/60 disabled:opacity-40"
                        >
                          <option value="">Choose salesperson</option>
                          {data.team.map((member) => (
                            <option key={member.userId} value={member.userId}>{member.name}{member.userId === data.currentUser ? " · you" : ""}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={busyId === record.id || !!record.blockedReason || (!record.shared && !assignmentDrafts[record.id])}
                          onClick={() => changeSharing(record, !record.shared)}
                          className={`min-h-10 rounded-full border px-4 font-mono text-[0.58rem] uppercase disabled:cursor-not-allowed disabled:opacity-35 ${record.shared ? "border-rust/45 bg-rust/10 text-rust" : "border-amber/50 bg-amber/10 text-amber"}`}
                        >
                          {busyId === record.id ? "Saving…" : record.shared ? "Make private" : "Share"}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === record.id}
                          onClick={() => changeConfidentiality(record, !record.confidential)}
                          className={`min-h-10 rounded-full border px-4 font-mono text-[0.58rem] uppercase disabled:cursor-not-allowed disabled:opacity-35 ${record.confidential ? "border-rust/60 bg-rust text-ink" : "border-edge bg-ink/60 text-muted hover:border-rust/45 hover:text-rust"}`}
                        >
                          {busyId === record.id
                            ? "Saving…"
                            : record.confidential
                              ? "Unlock"
                              : "Lock private"}
                        </button>
                      </div>
                    </article>
                  ))}
                  {!shownClients.length ? (
                    <p className="rounded-xl border border-dashed border-edge p-6 text-center text-sm text-muted">No client records match this view.</p>
                  ) : null}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
