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
import { crmFetch, getCached } from "@/lib/crm";
import TaskList from "@/components/crm/TaskList";

type Opp = {
  companyId: string;
  company: string;
  value: number | null;
  valueIsEstimate: boolean;
  count: number;
  dueSoon: boolean;
  nextCallAt: string | null;
  reason: string;
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
}: {
  o: Opp;
  open: boolean;
  onToggle: () => void;
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
      <div className="flex items-center gap-2 px-2 py-2">
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
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="flex-none font-mono text-[0.7rem] text-muted">
            {open ? "▾" : "▸"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-sans text-[0.9rem] text-bone">
              {o.company}
            </span>
            {o.reason && (
              <span className="block truncate font-mono text-[0.56rem] uppercase tracking-wider text-muted">
                {o.reason}
              </span>
            )}
          </span>
        </button>

        {/* Signals: value, count, next-call time. */}
        <span className="flex flex-none items-center gap-1.5">
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
        </span>
      </div>

      {open && (
        <div className="border-t border-edge/60 px-3 pb-2 pt-1">
          {/* Reuse the full to-do behaviour (tick / dismiss / click-to-act). */}
          <TaskList companyId={o.companyId} emptyText="No open to-dos here." />
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

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || !board) return;
    const ids = board.opportunities.map((o) => o.companyId);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(board.opportunities, from, to);
    setBoard({ ...board, opportunities: next, manual: true });
    crmFetch("/api/crm/opportunities/order", {
      method: "POST",
      body: JSON.stringify({ order: next.map((o) => o.companyId) }),
    }).catch(() => {});
  };

  const resetOrder = () => {
    crmFetch("/api/crm/opportunities/order", { method: "DELETE" })
      .then(() => {
        setSavedNote("Back to the coach's order");
        setTimeout(() => setSavedNote(""), 2500);
        return crmFetch<Board>("/api/crm/opportunities/board");
      })
      .then((d) => d && setBoard(d))
      .catch(() => {});
  };

  if (!board || board.opportunities.length === 0) return null;

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
          items={board.opportunities.map((o) => o.companyId)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-1.5">
            {board.opportunities.map((o) => (
              <OppRow
                key={o.companyId}
                o={o}
                open={open === o.companyId}
                onToggle={() =>
                  setOpen((c) => (c === o.companyId ? null : o.companyId))
                }
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}
