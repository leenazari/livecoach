"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Props = {
  // Ranked focus list (order = priority). Labels double as stable drag ids,
  // so they must be unique - the add control guards against duplicates.
  items: string[];
  activeItems: string[];
  onReorder: (next: string[]) => void;
  onToggle: (c: string) => void;
  onDelete: (c: string) => void;
  onAdd: (c: string) => void;
};

function Row({
  id,
  index,
  total,
  active,
  onUp,
  onDown,
  onToggle,
  onDelete,
}: {
  id: string;
  index: number;
  total: number;
  active: boolean;
  onUp: () => void;
  onDown: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 transition ${
        active ? "border-amber/40 bg-amber/[0.06]" : "border-edge bg-ink/30"
      }`}
    >
      {/* drag handle - listeners live here so the buttons stay clickable */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        title="drag to reorder"
        className="cursor-grab touch-none px-1 text-muted transition hover:text-bone active:cursor-grabbing"
      >
        {"\u2630"}
      </button>

      <div className="flex flex-col leading-none">
        <button
          type="button"
          onClick={onUp}
          disabled={index === 0}
          title="move up"
          className="text-[0.7rem] text-muted transition hover:text-amber disabled:opacity-25"
        >
          {"\u25B2"}
        </button>
        <button
          type="button"
          onClick={onDown}
          disabled={index === total - 1}
          title="move down"
          className="text-[0.7rem] text-muted transition hover:text-amber disabled:opacity-25"
        >
          {"\u25BC"}
        </button>
      </div>

      <span className="w-4 font-mono text-[0.7rem] text-muted">{index + 1}</span>

      <span
        className={`flex-1 font-mono text-[0.78rem] uppercase tracking-wider ${
          active ? "text-bone" : "text-muted line-through"
        }`}
      >
        {id}
      </span>

      <button
        type="button"
        onClick={onToggle}
        className={`rounded-full border px-2.5 py-1 font-mono text-[0.58rem] uppercase tracking-wider transition ${
          active
            ? "border-amber/50 text-amber hover:bg-amber/10"
            : "border-sage/50 text-sage hover:bg-sage/10"
        }`}
      >
        {active ? "active" : "covered"}
      </button>

      <button
        type="button"
        onClick={onDelete}
        title="remove"
        className="px-1 font-mono text-sm text-muted transition hover:text-rust"
      >
        {"\u00D7"}
      </button>
    </div>
  );
}

export default function SortableFocusList({
  items,
  activeItems,
  onReorder,
  onToggle,
  onDelete,
  onAdd,
}: Props) {
  const [draft, setDraft] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.indexOf(active.id as string);
    const newIndex = items.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    onReorder(arrayMove(items, i, j));
  };

  const addDraft = () => {
    const v = draft.trim();
    if (!v) return;
    if (!items.some((x) => x.toLowerCase() === v.toLowerCase())) onAdd(v);
    setDraft("");
  };

  return (
    <div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {items.map((c, i) => (
              <Row
                key={c}
                id={c}
                index={i}
                total={items.length}
                active={activeItems.includes(c)}
                onUp={() => move(i, -1)}
                onDown={() => move(i, 1)}
                onToggle={() => onToggle(c)}
                onDelete={() => onDelete(c)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="mt-2 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDraft();
            }
          }}
          placeholder="add your own focus..."
          className="flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-[0.72rem] uppercase tracking-wider text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60"
        />
        <button
          type="button"
          onClick={addDraft}
          className="rounded-lg border border-amber/50 bg-amber/10 px-3 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-amber transition hover:bg-amber/20"
        >
          add
        </button>
      </div>
    </div>
  );
}
