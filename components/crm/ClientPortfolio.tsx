"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import {
  isNonCommercialRelationship,
  isRelationshipStageOption,
  RELATIONSHIP_STAGE_OPTIONS,
} from "@/lib/relationship-stages";
import { capitaliseSentenceStarts } from "@/lib/text";

export type ClientHealth = "red" | "amber" | "green" | "grey";

export type ClientPortfolioRow = {
  id: string;
  name: string;
  sector: string | null;
  relationshipStage: string | null;
  relationshipType: string | null;
  triageReviewedAt: string | null;
  archived: boolean;
  category: string;
  primaryContact: null | { name: string; role: string | null; email: string | null };
  health: ClientHealth;
  healthReason: string;
  healthReasons: string[];
  lastTouchAt: string | null;
  daysQuiet: number | null;
  nextMeetingAt: string | null;
  nextMeetingTitle: string | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
  openTaskCount: number;
  buyingSignal: string | null;
  opportunity: null | {
    id: string;
    title: string;
    stage: string;
    probability: number;
    value: number | null;
  };
};

export type ClientPortfolioTotals = Record<ClientHealth, number> & {
  all: number;
  opportunities: number;
  archived: number;
};

const HEALTH = {
  red: {
    label: "Needs action",
    dot: "bg-rust",
    border: "border-rust/45",
    surface: "bg-rust/[0.07]",
    text: "text-rust",
  },
  amber: {
    label: "Watch",
    dot: "bg-amber",
    border: "border-amber/40",
    surface: "bg-amber/[0.06]",
    text: "text-amber",
  },
  green: {
    label: "On track",
    dot: "bg-sage",
    border: "border-sage/40",
    surface: "bg-sage/[0.06]",
    text: "text-sage",
  },
  grey: {
    label: "Needs details",
    dot: "bg-muted",
    border: "border-edge",
    surface: "bg-panel/30",
    text: "text-muted",
  },
} as const;

const compactDate = (iso: string | null) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "2-digit",
    timeZone: "Europe/London",
  });
};

const activityDate = (iso: string | null) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  });
};

const meetingDate = (iso: string | null) => {
  if (!iso) return "Not booked";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not booked";
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  });
};

const gbp = (value: number | null) =>
  value == null ? "Value unknown" : `£${Math.round(value).toLocaleString()}`;

function HealthBadge({ row }: { row: ClientPortfolioRow }) {
  const style = HEALTH[row.health];
  return (
    <Link
      href={`/crm/${row.id}`}
      title={row.healthReasons.join(" · ")}
      aria-label={`Open ${row.name}: ${style.label}`}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[0.52rem] uppercase tracking-wider transition hover:brightness-125 ${style.border} ${style.surface} ${style.text}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
      <span className="truncate">{style.label}</span>
    </Link>
  );
}

function StageSelect({
  row,
  saving,
  onChange,
}: {
  row: ClientPortfolioRow;
  saving: boolean;
  onChange: (id: string, stage: string) => void;
}) {
  const current = row.relationshipStage || "";
  return (
    <select
      aria-label={`Relationship stage for ${row.name}`}
      value={current}
      disabled={saving}
      onChange={(event) => onChange(row.id, event.target.value)}
      className={`max-w-full rounded-full border bg-ink/80 px-2 py-1 font-mono text-[0.55rem] uppercase tracking-wider outline-none transition focus:border-amber/70 disabled:opacity-50 ${
        isNonCommercialRelationship(current)
          ? "border-sky/55 bg-sky/10 text-sky"
          : current
            ? "border-edge text-bone/80"
            : "border-amber/50 text-amber"
      }`}
    >
      <option value="">Set stage…</option>
      {current && !isRelationshipStageOption(current) ? (
        <option value={current}>{current}</option>
      ) : null}
      {RELATIONSHIP_STAGE_OPTIONS.map((stage) => (
        <option key={stage} value={stage}>
          {stage}
        </option>
      ))}
    </select>
  );
}

function MobileClientCard({
  row,
  saving,
  onStageChange,
  onDelete,
}: {
  row: ClientPortfolioRow;
  saving: boolean;
  onStageChange: (id: string, stage: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const style = HEALTH[row.health];
  return (
    <article
      style={{ contentVisibility: "auto" }}
      className={`rounded-xl border p-3 ${style.border} ${style.surface}`}
    >
      <div className="flex items-start justify-between gap-3">
        <Link href={`/crm/${row.id}`} className="min-w-0 flex-1">
          <p className="truncate font-sans text-[0.96rem] font-medium text-bone">{row.name}</p>
          <p className="mt-0.5 truncate font-mono text-[0.54rem] uppercase tracking-wider text-muted">
            {[row.category, row.sector].filter(Boolean).join(" · ")}
          </p>
        </Link>
        <HealthBadge row={row} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 border-y border-edge/45 py-3">
        <Link href={`/crm/${row.id}`} className="min-w-0 rounded-md hover:bg-bone/[0.035]">
          <p className="font-mono text-[0.48rem] uppercase tracking-wider text-muted">Contact</p>
          <p className="truncate font-sans text-[0.76rem] text-bone/90">
            {row.primaryContact?.name || "Not recorded"}
          </p>
          <p className="truncate font-sans text-[0.66rem] text-muted">
            {row.primaryContact?.role || row.primaryContact?.email || ""}
          </p>
        </Link>
        <Link href={`/crm/${row.id}`} className="min-w-0 rounded-md hover:bg-bone/[0.035]">
          <p className="font-mono text-[0.48rem] uppercase tracking-wider text-muted">Next meeting</p>
          <p className={`truncate font-sans text-[0.76rem] ${row.nextMeetingAt ? "text-sage" : "text-muted"}`}>
            {meetingDate(row.nextMeetingAt)}
          </p>
        </Link>
        <Link href={`/crm/${row.id}`} className="min-w-0 rounded-md hover:bg-bone/[0.035]">
          <p className="font-mono text-[0.48rem] uppercase tracking-wider text-muted">Last activity</p>
          <p className="truncate font-sans text-[0.76rem] text-bone/80">
            {activityDate(row.lastTouchAt)}
            {row.daysQuiet != null ? ` · ${row.daysQuiet}d` : ""}
          </p>
        </Link>
        <Link href={`/crm/${row.id}`} className="min-w-0 rounded-md hover:bg-bone/[0.035]">
          <p className="font-mono text-[0.48rem] uppercase tracking-wider text-muted">Commercial</p>
          <p className="truncate font-sans text-[0.76rem] text-bone/80">
            {row.opportunity ? `${row.opportunity.probability}% · ${gbp(row.opportunity.value)}` : "No open deal"}
          </p>
        </Link>
      </div>

      <div className="mt-3">
        <Link href={`/crm/${row.id}`} className="block rounded-md transition hover:bg-bone/[0.035]">
          <p className="font-mono text-[0.48rem] uppercase tracking-wider text-amber">Next move</p>
          <p className="mt-0.5 line-clamp-2 font-sans text-[0.78rem] leading-snug text-bone/90">
            {capitaliseSentenceStarts(row.nextAction || row.healthReason)}
          </p>
          {row.buyingSignal ? (
            <p className="mt-1.5 line-clamp-2 font-sans text-[0.7rem] leading-snug text-sage">
              ◆ {capitaliseSentenceStarts(row.buyingSignal)}
            </p>
          ) : null}
        </Link>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <StageSelect row={row} saving={saving} onChange={onStageChange} />
        <span className="flex items-center gap-1">
          <Link
            href={`/crm/${row.id}`}
            className="rounded-full border border-sky/40 bg-sky/10 px-2.5 py-1 font-mono text-[0.52rem] uppercase tracking-wider text-sky"
          >
            open
          </Link>
          <button
            type="button"
            onClick={() => onDelete(row.id, row.name)}
            aria-label={`Delete ${row.name}`}
            className="rounded-full border border-edge px-2.5 py-1 font-mono text-[0.62rem] text-muted transition hover:border-rust/50 hover:text-rust"
          >
            ×
          </button>
        </span>
      </div>
    </article>
  );
}

export default function ClientPortfolio({
  clients,
  totals,
  newName,
  setNewName,
  onCreate,
  onDelete,
  onStageChange,
  savingId,
}: {
  clients: ClientPortfolioRow[];
  totals: ClientPortfolioTotals;
  newName: string;
  setNewName: (value: string) => void;
  onCreate: () => void;
  onDelete: (id: string, name: string) => void;
  onStageChange: (id: string, stage: string) => void;
  savingId: string;
}) {
  const [query, setQuery] = useState("");
  const [health, setHealth] = useState<
    "all" | ClientHealth | "opportunities" | "archived"
  >("all");
  const [stage, setStage] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [sort, setSort] = useState<{
    key: "priority" | "health" | "name" | "contact" | "stage" | "lastActivity" | "nextMeeting" | "commercial" | "nextMove";
    direction: "asc" | "desc";
  }>({ key: "priority", direction: "asc" });
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const stages = useMemo(
    () =>
      [...new Set(clients.map((row) => row.relationshipStage).filter((value): value is string => !!value))]
        .sort((a, b) => a.localeCompare(b)),
    [clients]
  );

  const shown = useMemo(() => {
      const filtered = clients.filter((row) => {
        if (health === "archived" && !row.archived) return false;
        if (health !== "archived" && row.archived) return false;
        if (health === "opportunities" && !row.opportunity) return false;
        if (
          health !== "all" &&
          health !== "opportunities" &&
          health !== "archived" &&
          row.health !== health
        )
          return false;
        if (stage !== "all" && row.relationshipStage !== stage) return false;
        if (!deferredQuery) return true;
        const haystack = [
          row.name,
          row.sector,
          row.relationshipStage,
          row.primaryContact?.name,
          row.primaryContact?.role,
          row.primaryContact?.email,
          row.nextAction,
          row.buyingSignal,
          activityDate(row.lastTouchAt),
          meetingDate(row.nextMeetingAt),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(deferredQuery);
      });
      if (sort.key === "priority") return filtered;
      const healthRank = { red: 0, amber: 1, green: 2, grey: 3 } as const;
      const timestamp = (value: string | null, empty: number) => {
        if (!value) return empty;
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : empty;
      };
      const textValue = (row: ClientPortfolioRow) => {
        if (sort.key === "name") return row.name;
        if (sort.key === "contact") return row.primaryContact?.name || "";
        if (sort.key === "stage") return row.relationshipStage || "";
        if (sort.key === "nextMove") return row.nextAction || row.healthReason;
        return "";
      };
      return [...filtered].sort((a, b) => {
        let comparison = 0;
        if (sort.key === "health") comparison = healthRank[a.health] - healthRank[b.health];
        else if (["name", "contact", "stage", "nextMove"].includes(sort.key)) {
          comparison = textValue(a).localeCompare(textValue(b), "en-GB", { sensitivity: "base" });
        } else if (sort.key === "lastActivity") {
          comparison = timestamp(a.lastTouchAt, -Infinity) - timestamp(b.lastTouchAt, -Infinity);
        } else if (sort.key === "nextMeeting") {
          comparison = timestamp(a.nextMeetingAt, Infinity) - timestamp(b.nextMeetingAt, Infinity);
        } else if (sort.key === "commercial") {
          comparison =
            (a.opportunity?.value ?? a.opportunity?.probability ?? -1) -
            (b.opportunity?.value ?? b.opportunity?.probability ?? -1);
        }
        if (comparison === 0) comparison = a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" });
        return sort.direction === "asc" ? comparison : -comparison;
      });
    }, [clients, deferredQuery, health, sort, stage]);

  const chooseSort = (key: typeof sort.key) => {
    setSort((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === "asc" ? "desc" : "asc" };
      }
      return {
        key,
        direction: key === "lastActivity" || key === "commercial" ? "desc" : "asc",
      };
    });
  };

  const sortMark = (key: typeof sort.key) =>
    sort.key === key ? (sort.direction === "asc" ? " ↑" : " ↓") : " ↕";

  const healthFilters: {
    key: "all" | ClientHealth | "opportunities" | "archived";
    label: string;
    count: number;
  }[] = [
    { key: "all", label: "All", count: totals.all },
    { key: "red", label: "Needs action", count: totals.red },
    { key: "amber", label: "Watch", count: totals.amber },
    { key: "green", label: "On track", count: totals.green },
    { key: "grey", label: "Needs details", count: totals.grey },
    { key: "opportunities", label: "Opportunities", count: totals.opportunities },
    { key: "archived", label: "Archived", count: totals.archived },
  ];

  return (
    <section>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Clients", totals.all, "text-bone", "all"],
          ["Needs action", totals.red, "text-rust", "red"],
          ["Watch", totals.amber, "text-amber", "amber"],
          ["Opportunities", totals.opportunities, "text-sage", "opportunities"],
        ].map(([label, value, color, filter]) => (
          <button
            key={String(label)}
            type="button"
            onClick={() => setHealth(filter as "all" | ClientHealth | "opportunities" | "archived")}
            aria-pressed={health === filter}
            className={`rounded-xl border bg-panel/35 px-3 py-2.5 text-left transition hover:border-amber/55 hover:bg-amber/[0.04] ${health === filter ? "border-amber/55" : "border-edge"}`}
          >
            <p className={`font-display text-[1.35rem] leading-none ${color}`}>{value}</p>
            <p className="mt-1 font-mono text-[0.5rem] uppercase tracking-[0.14em] text-muted">{label} ↘</p>
          </button>
        ))}
      </div>

      <div className="mb-3 rounded-xl border border-edge bg-panel/35 p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search client, contact, sector or next move…"
            className="min-w-0 flex-1 rounded-lg border border-edge bg-ink/70 px-3 py-2 font-sans text-sm text-bone outline-none placeholder:text-muted/60 focus:border-amber/60"
          />
          <select
            aria-label="Filter clients by relationship stage"
            value={stage}
            onChange={(event) => setStage(event.target.value)}
            className="rounded-lg border border-edge bg-ink/70 px-3 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-bone outline-none focus:border-amber/60"
          >
            <option value="all">All stages</option>
            {stages.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowAdd((open) => !open)}
            className="rounded-lg border border-amber/55 bg-amber/10 px-3 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/20"
          >
            {showAdd ? "Cancel" : "+ Add client"}
          </button>
        </div>
        {showAdd ? (
          <div className="mt-2 flex gap-2 border-t border-edge/50 pt-2">
            <input
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && onCreate()}
              placeholder="New client name"
              className="min-w-0 flex-1 rounded-lg border border-edge bg-ink/70 px-3 py-2 font-sans text-sm text-bone outline-none focus:border-amber/60"
            />
            <button
              type="button"
              onClick={onCreate}
              disabled={!newName.trim()}
              className="rounded-lg border border-amber/55 bg-amber/15 px-4 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-amber disabled:opacity-40"
            >
              Add
            </button>
          </div>
        ) : null}
      </div>

      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {healthFilters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setHealth(filter.key)}
            className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[0.53rem] uppercase tracking-wider transition ${
              health === filter.key
                ? filter.key === "all"
                  ? "border-sky/55 bg-sky/10 text-sky"
                  : filter.key === "opportunities"
                    ? "border-sage/40 bg-sage/[0.06] text-sage"
                    : filter.key === "archived"
                      ? "border-edge bg-panel/40 text-muted"
                    : `${HEALTH[filter.key].border} ${HEALTH[filter.key].surface} ${HEALTH[filter.key].text}`
                : "border-edge text-muted hover:text-bone"
            }`}
          >
            {filter.label} · {filter.count}
          </button>
        ))}
      </div>

      <p className="mb-2 font-mono text-[0.54rem] uppercase tracking-wider text-muted">
        Showing {shown.length} of {health === "archived" ? totals.archived : totals.all} · red and overdue relationships appear first
      </p>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-edge bg-panel/30 p-5 text-center font-sans text-sm text-muted">
          No clients match these filters.
        </div>
      ) : null}

      <div className="flex flex-col gap-2 md:hidden">
        {shown.map((row) => (
          <MobileClientCard
            key={row.id}
            row={row}
            saving={savingId === row.id}
            onStageChange={onStageChange}
            onDelete={onDelete}
          />
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-edge md:block">
        <table className="w-full min-w-[1040px] border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-ink">
            <tr className="border-b border-edge">
              {[
                ["health", "Status"],
                ["name", "Client & category"],
                ["contact", "Main contact"],
                ["stage", "Stage"],
                ["lastActivity", "Last activity"],
                ["nextMeeting", "Next meeting"],
                ["commercial", "Commercial position"],
                ["nextMove", "Priority next move"],
              ].map(([key, label]) => {
                const typedKey = key as typeof sort.key;
                return (
                  <th
                    key={key}
                    aria-sort={sort.key === typedKey ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                    className="whitespace-nowrap px-3 py-2.5 font-mono text-[0.5rem] font-normal uppercase tracking-[0.14em] text-muted"
                  >
                    <button type="button" onClick={() => chooseSort(typedKey)} className="transition hover:text-amber">
                      {label}{sortMark(typedKey)}
                    </button>
                  </th>
                );
              })}
              <th className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const style = HEALTH[row.health];
              return (
                <tr
                  key={row.id}
                  style={{ contentVisibility: "auto" }}
                  className={`border-b border-edge/55 align-top last:border-0 transition hover:bg-bone/[0.025] ${style.surface}`}
                >
                  <td className="px-3 py-3"><HealthBadge row={row} /></td>
                  <td className="max-w-[180px] px-3 py-3">
                    <Link href={`/crm/${row.id}`} className="block min-w-0">
                      <p className="truncate font-sans text-[0.84rem] font-medium text-bone hover:text-amber">{row.name}</p>
                      <p className="mt-0.5 truncate font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                        {[row.category, row.sector].filter(Boolean).join(" · ")}
                      </p>
                    </Link>
                  </td>
                  <td className="max-w-[170px] px-3 py-3">
                    <Link href={`/crm/${row.id}`} className="block hover:text-amber">
                      <p className="truncate font-sans text-[0.76rem] text-bone/90">{row.primaryContact?.name || "Not recorded"}</p>
                      <p className="truncate font-sans text-[0.64rem] text-muted">{row.primaryContact?.role || row.primaryContact?.email || ""}</p>
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <StageSelect row={row} saving={savingId === row.id} onChange={onStageChange} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <Link href={`/crm/${row.id}`} className="block hover:text-amber">
                      <p className="font-sans text-[0.74rem] text-bone/80">{activityDate(row.lastTouchAt)}</p>
                      <p className="font-mono text-[0.49rem] uppercase tracking-wider text-muted">
                        {row.daysQuiet == null
                          ? "Unknown"
                          : row.daysQuiet === 0
                            ? "Today"
                            : `${row.daysQuiet} ${row.daysQuiet === 1 ? "day" : "days"} ago`}
                      </p>
                    </Link>
                  </td>
                  <td className="max-w-[150px] px-3 py-3">
                    <Link href={`/crm/${row.id}`} className={`block font-sans text-[0.72rem] hover:text-amber ${row.nextMeetingAt ? "text-sage" : "text-muted"}`}>
                      {meetingDate(row.nextMeetingAt)}
                    </Link>
                  </td>
                  <td className="max-w-[180px] px-3 py-3">
                    {row.opportunity ? (
                      <Link href={`/crm/${row.id}`} className="block hover:text-amber">
                        <p className="truncate font-sans text-[0.74rem] text-bone/90">{row.opportunity.title}</p>
                        <p className="font-mono text-[0.5rem] uppercase tracking-wider text-sage">
                          {row.opportunity.probability}% · {gbp(row.opportunity.value)}
                        </p>
                      </Link>
                    ) : (
                      <p className="font-sans text-[0.72rem] text-muted">No open opportunity</p>
                    )}
                    {row.buyingSignal ? (
                      <Link href={`/crm/${row.id}`} title={row.buyingSignal} className="mt-1 block line-clamp-2 font-sans text-[0.64rem] leading-snug text-sage/90 hover:text-sage">◆ {capitaliseSentenceStarts(row.buyingSignal)}</Link>
                    ) : null}
                  </td>
                  <td className="max-w-[220px] px-3 py-3">
                    <Link href={`/crm/${row.id}`} className="block hover:text-amber">
                      <p className="line-clamp-2 font-sans text-[0.72rem] leading-snug text-bone/90">{capitaliseSentenceStarts(row.nextAction || row.healthReason)}</p>
                      <p className={`mt-1 font-mono text-[0.49rem] uppercase tracking-wider ${row.nextActionDueAt && new Date(row.nextActionDueAt).getTime() < Date.now() ? "text-rust" : "text-muted"}`}>
                        {row.openTaskCount ? `${row.openTaskCount} open · ` : ""}{row.nextActionDueAt ? `due ${compactDate(row.nextActionDueAt)}` : "no deadline"}
                      </p>
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="inline-flex items-center gap-1">
                      <Link href={`/crm/${row.id}`} aria-label={`Open ${row.name}`} className="rounded-full border border-sky/35 px-2 py-1 font-mono text-[0.52rem] text-sky transition hover:bg-sky/10">↗</Link>
                      <button type="button" onClick={() => onDelete(row.id, row.name)} aria-label={`Delete ${row.name}`} className="rounded-full border border-edge px-2 py-1 font-mono text-[0.6rem] text-muted transition hover:border-rust/50 hover:text-rust">×</button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
