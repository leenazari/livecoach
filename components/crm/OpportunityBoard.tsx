"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { crmConfirmationError, crmFetch, getCached } from "@/lib/crm";
import TaskList from "@/components/crm/TaskList";
import Link from "next/link";
import { capitaliseSentenceStarts } from "@/lib/text";
import {
  isNonCommercialRelationship,
  isRelationshipStageOption,
  RELATIONSHIP_STAGE_OPTIONS,
} from "@/lib/relationship-stages";

type Opp = {
  companyId: string;
  company: string;
  stage: string | null;
  value: number | null;
  valueIsEstimate: boolean;
  count: number;
  dueSoon: boolean;
  nextCallAt: string | null;
  lastTouchAt: string | null;
  daysQuiet: number | null;
  cooling: boolean;
  contactUnknown: boolean;
  reason: string;
  nextAction: string;
  alerts: { code: string; label: string; priority: number }[];
};
type Board = { opportunities: Opp[]; looseCount: number; manual: boolean };

// Short call-time label, e.g. "today 14:00" / "Tue 14:00".
const whenLabel = (iso: string | null) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const t = d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/London",
    });
    const today = new Date();
    return d.toDateString() === today.toDateString()
      ? `today ${t}`
      : `${d.toLocaleDateString("en-GB", {
          weekday: "short",
          timeZone: "Europe/London",
        })} ${t}`;
  } catch {
    return "";
  }
};

const gbp = (n: number) => `£${Math.round(n).toLocaleString()}`;

// One draggable, collapsible opportunity row. The grip is the only drag handle,
// so tapping the row toggles its to-dos and only the grip starts a reorder
// (works on touch). Expanding mounts the existing TaskList for that client.
function OppRow({
  o,
  open,
  onToggle,
  onStageChange,
}: {
  o: Opp;
  open: boolean;
  onToggle: () => void;
  onStageChange: (stage: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: o.companyId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="overflow-hidden rounded-lg border border-edge bg-ink/40"
    >
      <div className="flex flex-wrap items-center gap-2 px-2 py-2 sm:flex-nowrap">
        {/* Drag handle */}
        <button
          type="button"
          aria-label="drag to reorder"
          className="flex-none cursor-grab touch-none px-1 font-mono text-[0.9rem] text-muted active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>

        {/* The row body toggles the to-dos. */}
        <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <button
            type="button"
            onClick={onToggle}
            aria-label={`${open ? "hide" : "show"} to-dos for ${o.company}`}
            className="flex-none font-mono text-[0.7rem] text-muted"
          >
            {open ? "▾" : "▸"}
          </button>
          <span className="min-w-0 flex-1">
            <Link
              href={`/crm/${o.companyId}`}
              className="block truncate font-sans text-[0.9rem] text-bone transition hover:text-amber"
            >
              {o.company}
            </Link>
            {o.nextAction && (
              <button type="button" onClick={onToggle} className="block w-full truncate text-left font-sans text-[0.76rem] leading-snug text-amber/90">
                <span className="font-mono text-[0.5rem] uppercase tracking-wider text-amber/65">
                  Next move ·{" "}
                </span>
                {capitaliseSentenceStarts(o.nextAction)}
              </button>
            )}
            {o.reason && (
              <button type="button" onClick={onToggle} className="block w-full truncate text-left font-mono text-[0.52rem] uppercase tracking-wider text-muted">
                Why · {capitaliseSentenceStarts(o.reason)}
              </button>
            )}
          </span>
        </div>

        {/* Signals: value, count, next-call time. */}
        <span className="ml-8 flex w-full flex-wrap items-center gap-1.5 sm:ml-0 sm:w-auto sm:flex-none sm:flex-nowrap">
          <select
            aria-label={`relationship stage for ${o.company}`}
            value={o.stage || ""}
            onChange={(e) => onStageChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className={`max-w-[8rem] rounded-full border bg-ink px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider outline-none transition focus:border-amber/70 ${
              isNonCommercialRelationship(o.stage)
                ? "border-sky/55 bg-sky/10 text-sky"
                : o.stage
                  ? "border-edge text-bone/75"
                  : "border-amber/55 bg-amber/10 text-amber"
            }`}
          >
            <option value="">set stage…</option>
            {o.stage && !isRelationshipStageOption(o.stage) ? (
              <option value={o.stage}>{o.stage}</option>
            ) : null}
            {RELATIONSHIP_STAGE_OPTIONS.map((stage) => (
              <option key={stage} value={stage}>
                {stage.toLowerCase()}
              </option>
            ))}
          </select>
          {o.value ? (
            <span
              title={o.valueIsEstimate ? "coach estimate" : "deal value"}
              className="rounded-full border border-sage/40 bg-sage/10 px-2 py-0.5 font-mono text-[0.56rem] text-sage"
            >
              {gbp(o.value)}
              {o.valueIsEstimate ? " est" : ""}
            </span>
          ) : null}
          <span className="rounded-full border border-edge px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider text-muted">
            {o.count} {o.count === 1 ? "to-do" : "to-dos"}
          </span>
          {o.nextCallAt ? (
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider ${
                o.dueSoon
                  ? "border border-amber/60 bg-amber/15 text-amber"
                  : "border border-edge text-muted"
              }`}
            >
              {o.dueSoon ? "▲ " : ""}
              {whenLabel(o.nextCallAt)}
            </span>
          ) : null}
          {o.cooling && o.daysQuiet != null ? (
            <span
              title={`No recorded call or email activity for ${o.daysQuiet} days`}
              className="rounded-full border border-rose/45 bg-rose/10 px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider text-rose"
            >
              quiet {o.daysQuiet}d
            </span>
          ) : null}
          {o.contactUnknown ? (
            <span
              title="No call or email date is recorded for this opportunity"
              className="rounded-full border border-edge px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider text-muted"
            >
              no contact date
            </span>
          ) : null}
        </span>
      </div>

      {o.alerts?.length ? (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {o.alerts.slice(0, 3).map((alert) => (
            <span
              key={alert.code}
              className={`rounded-full border px-2 py-0.5 font-mono text-[0.5rem] uppercase tracking-wider ${
                alert.priority === 1
                  ? "border-rust/55 bg-rust/10 text-rust"
                  : "border-amber/45 bg-amber/10 text-amber"
              }`}
            >
              {alert.priority === 1 ? "▲ " : ""}{alert.label}
            </span>
          ))}
        </div>
      ) : null}

      {open && (
        <div className="border-t border-edge/60 px-3 pb-2 pt-1">
          {/* Reuse the full to-do behaviour (tick / dismiss / click-to-act). */}
          <TaskList
            companyId={o.companyId}
            companyName={o.company}
            emptyText="No open to-dos here."
          />
          <Link
            href="/crm/board?tab=opportunities"
            className="mt-2 inline-block font-mono text-[0.52rem] uppercase tracking-wider text-amber hover:text-bone"
          >
            edit mutual close plan ↗
          </Link>
        </div>
      )}
    </li>
  );
}

// The opportunity-grouped, prioritised view. A short ranked list of deals, calm
// and collapsed by default. The coach ranks; Lee drags to override.
export default function OpportunityBoard() {
  const seed = getCached<Board>("/api/crm/opportunities/board");
  const [board, setBoard] = useState<Board | null>(seed || null);
  const [open, setOpen] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState("");
  // Show the top 10 ranked deals by default, the rest behind an expand button.
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 10;

  const sensors = useSensors(
    // A little movement before a drag starts, so taps still toggle the row.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 6 },
    })
  );

  useEffect(() => {
    // Instant heuristic order first, then fold in the coach's ranking.
    crmFetch<Board>("/api/crm/opportunities/board?light=1")
      .then((d) => setBoard((p) => (p ? { ...p, ...d } : d)))
      .catch(() => {});
    crmFetch<Board>("/api/crm/opportunities/board")
      .then((d) => setBoard(d))
      .catch(() => {});
  }, []);

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || !board) return;
    const ids = board.opportunities.map((o) => o.companyId);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(board.opportunities, from, to);
    setBoard({ ...board, opportunities: next, manual: true });
    try {
      const result = await crmFetch<{ ok: boolean; count: number }>(
        "/api/crm/opportunities/order", {
        method: "POST",
        body: JSON.stringify({ order: next.map((o) => o.companyId) }),
      });
      if (!result.ok || result.count !== next.length)
        throw crmConfirmationError({
          url: "/api/crm/opportunities/order",
          method: "POST",
          reason: "LiveCoach did not confirm the complete opportunity order",
        });
      setSavedNote("Order saved");
      setTimeout(() => setSavedNote(""), 1800);
    } catch {
      setBoard(board);
      setSavedNote("Order did not save. Please try again.");
    }
  };

  const resetOrder = () => {
    crmFetch<{ ok: boolean; count: number }>("/api/crm/opportunities/order", {
      method: "DELETE",
    })
      .then((result) => {
        if (!result.ok || result.count !== 0)
          throw crmConfirmationError({
            url: "/api/crm/opportunities/order",
            method: "DELETE",
            reason: "LiveCoach did not confirm that the opportunity order was reset",
          });
        setSavedNote("Back to the coach's order");
        setTimeout(() => setSavedNote(""), 2500);
        return crmFetch<Board>("/api/crm/opportunities/board");
      })
      .then((d) => d && setBoard(d))
      .catch(() => setSavedNote("Order reset did not save. Please try again."));
  };

  const setStage = async (companyId: string, stage: string) => {
    if (!board) return;
    const previous = board;
    setBoard({
      ...board,
      opportunities: board.opportunities.map((o) =>
        o.companyId === companyId ? { ...o, stage: stage || null } : o
      ),
    });
    try {
      const { company } = await crmFetch<{
        company: { id: string; stage: string | null };
      }>(`/api/crm/companies/${companyId}`, {
        method: "PATCH",
        body: JSON.stringify({ stage }),
      });
      if ((company?.stage || null) !== (stage || null))
        throw crmConfirmationError({
          url: `/api/crm/companies/${companyId}`,
          method: "PATCH",
          reason: "LiveCoach returned a different relationship stage from the one selected",
        });
      setBoard((current) =>
        current
          ? {
              ...current,
              opportunities: current.opportunities.map((opportunity) =>
                opportunity.companyId === companyId
                  ? { ...opportunity, stage: company.stage }
                  : opportunity
              ),
            }
          : current
      );
    } catch {
      setBoard(previous);
      setSavedNote("Stage did not save. Please try again.");
    }
  };

  if (!board || board.opportunities.length === 0) return null;

  const visible = showAll
    ? board.opportunities
    : board.opportunities.slice(0, LIMIT);

  return (
    <div className="mb-3 rounded-xl border border-edge bg-panel/40 p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          {"◆"} Opportunities{" "}
          <span className="text-muted">
            · {board.opportunities.length} ranked
          </span>
        </p>
        {board.manual ? (
          <button
            type="button"
            onClick={resetOrder}
            title="clear your order and use the coach's ranking"
            className="font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:text-amber"
          >
            reset to coach order ↺
          </button>
        ) : (
          <span className="font-mono text-[0.54rem] uppercase tracking-wider text-muted">
            coach-ranked · drag to reorder
          </span>
        )}
      </div>
      <p className="mb-2.5 font-sans text-[0.76rem] leading-snug text-bone/60">
        One specific next move for every active opportunity, grounded in its
        calls, email activity, promises, stage, calendar and open work. Missing
        stages and quiet deals are flagged before they disappear.
      </p>

      {savedNote && (
        <p className="mb-2 font-mono text-[0.56rem] uppercase tracking-wider text-sage">
          {savedNote}
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={visible.map((o) => o.companyId)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-1.5">
            {visible.map((o) => (
              <OppRow
                key={o.companyId}
                o={o}
                open={open === o.companyId}
                onToggle={() =>
                  setOpen((c) => (c === o.companyId ? null : o.companyId))
                }
                onStageChange={(stage) => setStage(o.companyId, stage)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {board.opportunities.length > LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2.5 w-full rounded-lg border border-edge px-3 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          {showAll ? "show less" : `show all ${board.opportunities.length}`}
        </button>
      )}
    </div>
  );
}
