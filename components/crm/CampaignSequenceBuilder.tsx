"use client";

import { useMemo, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createOutreachSequenceStep,
  moveOutreachSequenceStep,
  OUTREACH_SEQUENCE_MAX_STEPS,
  OUTREACH_SEQUENCE_TEMPLATES,
  outreachSequenceValidationError,
  renumberOutreachSequence,
  type OutreachSequenceContentType,
  type OutreachSequenceStep,
} from "@/lib/outreach-sequence";

type Props = {
  campaignId: string;
  sequence: OutreachSequenceStep[];
  disabled?: boolean;
  saving?: boolean;
  onChange: (next: OutreachSequenceStep[]) => void;
  onSave: () => void;
};

const field =
  "w-full rounded-lg border border-edge bg-ink/50 px-3 py-2.5 text-sm text-bone placeholder:text-muted focus:border-amber/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55";
const secondaryButton =
  "min-h-10 rounded-lg border border-edge px-3 py-2 font-mono text-[0.56rem] uppercase tracking-wider text-bone transition hover:border-amber/60 hover:text-amber disabled:cursor-not-allowed disabled:opacity-35";
const saveButton =
  "min-h-11 rounded-lg border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-40";

function templateFor(type?: OutreachSequenceContentType) {
  return (
    OUTREACH_SEQUENCE_TEMPLATES.find((item) => item.contentType === type) ||
    OUTREACH_SEQUENCE_TEMPLATES[0]
  );
}

function SortableSequenceStep({
  id,
  item,
  index,
  total,
  disabled,
  onPatch,
  onMove,
  onRemove,
}: {
  id: string;
  item: OutreachSequenceStep;
  index: number;
  total: number;
  disabled: boolean;
  onPatch: (patch: Partial<OutreachSequenceStep>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(index === 0);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  const template = templateFor(item.contentType);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <li ref={setNodeRef} style={style} className="relative">
      {index > 0 ? (
        <div className="mx-auto flex h-10 w-px items-center justify-center bg-edge">
          <span className="absolute rounded-full border border-edge bg-ink px-2 py-1 font-mono text-[0.48rem] uppercase text-muted">
            Wait {item.delayDays || 3}d
          </span>
        </div>
      ) : null}
      <article
        className={`overflow-hidden rounded-xl border bg-panel/75 transition ${
          isDragging
            ? "border-amber shadow-[0_18px_45px_rgba(0,0,0,0.45)]"
            : "border-edge hover:border-amber/45"
        }`}
      >
        <div className="flex items-center gap-2 p-3">
          <button
            type="button"
            {...attributes}
            {...listeners}
            disabled={disabled}
            aria-label={`Drag sequence step ${index + 1}`}
            title="Drag to reorder"
            className="grid min-h-10 min-w-10 touch-none cursor-grab place-items-center rounded-lg border border-edge text-muted transition hover:border-amber/50 hover:text-amber active:cursor-grabbing disabled:cursor-not-allowed"
          >
            ☰
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-amber/45 bg-amber/10 font-display text-base text-amber">
              {template.icon}
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                Step {index + 1} · Email
              </p>
              <strong className="block truncate text-sm text-bone">
                {item.purpose || template.label}
              </strong>
              <p className="mt-0.5 font-mono text-[0.48rem] uppercase text-amber">
                {template.label}
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-1 sm:flex">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={disabled || index === 0}
              aria-label={`Move step ${index + 1} earlier`}
              className="grid h-9 w-9 place-items-center rounded-lg border border-edge text-muted hover:border-amber/50 hover:text-amber disabled:opacity-25"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={disabled || index === total - 1}
              aria-label={`Move step ${index + 1} later`}
              className="grid h-9 w-9 place-items-center rounded-lg border border-edge text-muted hover:border-amber/50 hover:text-amber disabled:opacity-25"
            >
              ↓
            </button>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.52rem] uppercase text-muted transition hover:border-amber/50 hover:text-amber"
          >
            {expanded ? "Done" : "Edit"}
          </button>
        </div>

        {expanded ? (
          <div className="border-t border-edge bg-ink/25 p-3">
            <div className="mb-3 flex gap-2 sm:hidden">
              <button
                type="button"
                onClick={() => onMove(-1)}
                disabled={disabled || index === 0}
                className={`${secondaryButton} flex-1`}
              >
                Move earlier
              </button>
              <button
                type="button"
                onClick={() => onMove(1)}
                disabled={disabled || index === total - 1}
                className={`${secondaryButton} flex-1`}
              >
                Move later
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[8rem_12rem_minmax(0,1fr)]">
              <label>
                <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">
                  Wait days
                </span>
                <input
                  type="number"
                  min={index === 0 ? 0 : 1}
                  max="30"
                  disabled={disabled || index === 0}
                  className={field}
                  value={
                    index === 0
                      ? 0
                      : Number.isNaN(item.delayDays)
                        ? ""
                        : item.delayDays ?? 3
                  }
                  onChange={(event) =>
                    onPatch({
                      delayDays:
                        event.target.value === ""
                          ? Number.NaN
                          : Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">
                  Email type
                </span>
                <select
                  className={field}
                  value={item.contentType || "plain"}
                  disabled={disabled}
                  onChange={(event) =>
                    onPatch({
                      contentType: event.target
                        .value as OutreachSequenceContentType,
                    })
                  }
                >
                  {OUTREACH_SEQUENCE_TEMPLATES.map((option) => (
                    <option key={option.contentType} value={option.contentType}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">
                  Purpose
                </span>
                <input
                  className={field}
                  value={item.purpose || ""}
                  disabled={disabled}
                  onChange={(event) => onPatch({ purpose: event.target.value })}
                  placeholder="Why this email deserves a response"
                />
              </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label>
                <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">
                  Writing guidance
                </span>
                <textarea
                  className={`${field} min-h-24 resize-y`}
                  value={item.guidance || ""}
                  disabled={disabled}
                  onChange={(event) => onPatch({ guidance: event.target.value })}
                  placeholder="What new angle or proof should this step add?"
                />
              </label>
              <label>
                <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">
                  Approved asset link, optional
                </span>
                <input
                  type="url"
                  className={field}
                  value={item.assetUrl || ""}
                  disabled={disabled}
                  onChange={(event) => onPatch({ assetUrl: event.target.value })}
                  placeholder="https://… video, demo or case study"
                />
                <span className="mt-1 block text-xs leading-5 text-muted">
                  The exact link may be used, but the draft still waits for approval.
                </span>
              </label>
            </div>
            {!disabled && total > 1 ? (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={onRemove}
                  className="min-h-10 rounded-lg border border-rust/45 px-3 py-2 font-mono text-[0.54rem] uppercase text-rust transition hover:bg-rust/10"
                >
                  Remove step
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </article>
    </li>
  );
}

export default function CampaignSequenceBuilder({
  campaignId,
  sequence,
  disabled = false,
  saving = false,
  onChange,
  onSave,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const itemIds = useMemo(
    () => sequence.map((step, index) => `${campaignId}:${step.step}:${index}`),
    [campaignId, sequence]
  );
  const validationError = outreachSequenceValidationError(sequence);

  const reorder = (fromIndex: number, toIndex: number) => {
    onChange(moveOutreachSequenceStep(sequence, fromIndex, toIndex));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = itemIds.indexOf(String(active.id));
    const toIndex = itemIds.indexOf(String(over.id));
    if (fromIndex < 0 || toIndex < 0) return;
    reorder(fromIndex, toIndex);
  };

  const addStep = (contentType: OutreachSequenceContentType) => {
    if (disabled || sequence.length >= OUTREACH_SEQUENCE_MAX_STEPS) return;
    onChange([
      ...sequence,
      createOutreachSequenceStep(contentType, sequence.length),
    ]);
  };

  const patchStep = (
    index: number,
    patch: Partial<OutreachSequenceStep>
  ) => {
    onChange(
      sequence.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...patch } : step
      )
    );
  };

  const removeStep = (index: number) => {
    if (disabled || sequence.length <= 1) return;
    onChange(
      renumberOutreachSequence(
        sequence.filter((_, stepIndex) => stepIndex !== index)
      )
    );
  };

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-amber/35 bg-ink/30">
      <div className="border-b border-edge p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-[0.56rem] uppercase tracking-wider text-amber">
              Visual sequence builder
            </p>
            <h4 className="mt-1 font-display text-lg text-bone">
              Drag every campaign touch into order
            </h4>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
              Each step creates a fresh email draft for approval. Replies stop the remaining sequence automatically.
            </p>
          </div>
          {!disabled ? (
            <button
              type="button"
              onClick={onSave}
              disabled={saving || Boolean(validationError)}
              className={`${saveButton} w-full sm:w-auto`}
            >
              {saving ? "Saving…" : "Save sequence"}
            </button>
          ) : (
            <span className="self-start rounded-full border border-edge px-3 py-1 font-mono text-[0.5rem] uppercase text-muted">
              Shared · view only
            </span>
          )}
        </div>

        {!disabled ? (
          <div className="mt-4">
            <p className="mb-2 font-mono text-[0.5rem] uppercase tracking-wider text-muted">
              Add a step
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {OUTREACH_SEQUENCE_TEMPLATES.map((template) => (
                <button
                  type="button"
                  key={template.contentType}
                  onClick={() => addStep(template.contentType)}
                  disabled={sequence.length >= OUTREACH_SEQUENCE_MAX_STEPS}
                  className="min-h-12 min-w-[8.5rem] shrink-0 rounded-lg border border-edge bg-panel/65 px-3 py-2 text-left transition hover:border-amber/55 hover:bg-amber/[0.07] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <span className="mr-2 text-amber">{template.icon}</span>
                  <span className="font-mono text-[0.52rem] uppercase text-bone">
                    {template.shortLabel}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              Up to {OUTREACH_SEQUENCE_MAX_STEPS} approval-gated emails per campaign. LinkedIn actions will use the same builder after its provider connector is enabled.
            </p>
          </div>
        ) : null}
      </div>

      <div className="p-3 sm:p-4">
        {validationError ? (
          <p className="mb-3 rounded-lg border border-rust/45 bg-rust/10 px-3 py-2 text-sm text-rust" role="alert">
            {validationError}
          </p>
        ) : (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-moss/35 bg-moss/[0.06] px-3 py-2 text-xs text-moss">
            <span>✓ Ordered campaign workflow</span>
            <span>·</span>
            <span>✓ Human approval before every send</span>
            <span>·</span>
            <span>✓ Reply stops follow ups</span>
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <ol>
              {sequence.map((step, index) => (
                <SortableSequenceStep
                  key={itemIds[index]}
                  id={itemIds[index]}
                  item={step}
                  index={index}
                  total={sequence.length}
                  disabled={disabled}
                  onPatch={(patch) => patchStep(index, patch)}
                  onMove={(direction) => reorder(index, index + direction)}
                  onRemove={() => removeStep(index)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>

        {!sequence.length ? (
          <div className="rounded-xl border border-dashed border-edge p-6 text-center text-sm text-muted">
            Add the first email above to begin this campaign sequence.
          </div>
        ) : null}

        {!disabled ? (
          <div className="mt-4 flex flex-col gap-2 border-t border-edge pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted">
              Drag on desktop. Use the arrow controls on mobile or with a keyboard.
            </p>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || Boolean(validationError)}
              className={`${saveButton} w-full sm:w-auto`}
            >
              {saving ? "Saving…" : "Save sequence"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
