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
  createOutreachActionStep,
  createOutreachSequenceStep,
  defaultOutreachSequence,
  moveOutreachSequenceStep,
  OUTREACH_SEQUENCE_ACTION_TEMPLATES,
  OUTREACH_SEQUENCE_MAX_STEPS,
  OUTREACH_SEQUENCE_PRESETS,
  OUTREACH_SEQUENCE_TEMPLATES,
  outreachSequencePreset,
  outreachSequenceValidationError,
  renumberOutreachSequence,
  type OutreachSequenceActionTemplate,
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

function channelTone(channel: OutreachSequenceStep["channel"]) {
  if (channel === "linkedin") return {
    border: "border-sky/45",
    header: "bg-sky/[0.06]",
    badge: "border-sky/45 bg-sky/10 text-sky",
    text: "text-sky",
  };
  if (channel === "phone") return {
    border: "border-moss/45",
    header: "bg-moss/[0.06]",
    badge: "border-moss/45 bg-moss/10 text-moss",
    text: "text-moss",
  };
  return {
    border: "border-amber/45",
    header: "bg-amber/[0.05]",
    badge: "border-amber/45 bg-amber/10 text-amber",
    text: "text-amber",
  };
}

function templateFor(item: OutreachSequenceStep) {
  if ((item.channel || "email") !== "email") {
    const action = OUTREACH_SEQUENCE_ACTION_TEMPLATES.find(
      (template) => template.actionType === item.actionType
    );
    if (action) return action;
  }
  return (
    OUTREACH_SEQUENCE_TEMPLATES.find(
      (template) => template.contentType === item.contentType
    ) ||
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
  const template = templateFor(item);
  const manual = (item.channel || "email") !== "email";
  const tone = channelTone(item.channel || "email");
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
        className={`overflow-hidden rounded-xl border bg-panel/75 transition ${tone.border} ${
          isDragging
            ? "shadow-[0_18px_45px_rgba(0,0,0,0.45)]"
            : "hover:brightness-110"
        }`}
      >
        <div className={`flex items-center gap-2 p-3 ${tone.header}`}>
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
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border font-display text-base ${tone.badge}`}>
              {template.icon}
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                Step {index + 1} · {item.channel || "email"}
              </p>
              <strong className="block truncate text-sm text-bone">
                {item.purpose || template.label}
              </strong>
              <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 font-mono text-[0.46rem] uppercase ${tone.badge}`}>
                {template.label}{manual ? " · manual" : ""}
              </span>
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
            {manual ? (
              <p className="mb-3 rounded-lg border border-sky/35 bg-sky/[0.06] px-3 py-2 text-xs leading-5 text-sky">
                This is a human action. LiveCoach opens the right place and records your completion, but never clicks, likes, connects, calls or sends through LinkedIn for you.
              </p>
            ) : null}
            <div className={`grid gap-3 ${manual ? "sm:grid-cols-[8rem_minmax(0,1fr)]" : "sm:grid-cols-[8rem_12rem_minmax(0,1fr)]"}`}>
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
              {!manual ? <label>
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
              </label> : null}
              <label>
                <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">
                  Purpose
                </span>
                <input
                  className={field}
                  value={item.purpose || ""}
                  disabled={disabled}
                  onChange={(event) => onPatch({ purpose: event.target.value })}
                  placeholder={manual ? "Why this action matters" : "Why this email deserves a response"}
                />
              </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label>
                <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">
                  {manual ? "Completion guidance" : "Writing guidance"}
                </span>
                <textarea
                  className={`${field} min-h-24 resize-y`}
                  value={item.guidance || ""}
                  disabled={disabled}
                  onChange={(event) => onPatch({ guidance: event.target.value })}
                  placeholder={manual ? "What should the salesperson check or do?" : "What new angle or proof should this step add?"}
                />
              </label>
              <label>
                <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">
                  {manual ? "Helpful link, optional" : "Approved asset link, optional"}
                </span>
                <input
                  type="url"
                  className={field}
                  value={item.assetUrl || ""}
                  disabled={disabled}
                  onChange={(event) => onPatch({ assetUrl: event.target.value })}
                  placeholder={manual ? "https://… supporting page" : "https://… video, demo or case study"}
                />
                <span className="mt-1 block text-xs leading-5 text-muted">
                  {manual
                    ? "This link is only shown to the salesperson as guidance."
                    : "The exact link may be used, but the draft still waits for approval."}
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

  const addStep = (template: OutreachSequenceActionTemplate) => {
    if (disabled || sequence.length >= OUTREACH_SEQUENCE_MAX_STEPS) return;
    const next = template.actionType === "email"
      ? createOutreachSequenceStep(
          template.contentType as OutreachSequenceContentType,
          sequence.length
        )
      : createOutreachActionStep(template.actionType, sequence.length);
    onChange([
      ...sequence,
      next,
    ]);
  };

  const applyPreset = (presetId: string) => {
    if (disabled || !presetId) return;
    onChange(outreachSequencePreset(presetId));
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
    <section className="overflow-hidden rounded-xl border border-sky/40 bg-sky/[0.035]">
      <div className="border-b border-edge p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-[0.56rem] uppercase tracking-wider text-sky">
              Outreach sequence
            </p>
            <h4 className="mt-1 font-display text-lg text-bone">
              Start with one clear email
            </h4>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
              Add another touch only when it has a distinct purpose. Email is amber, LinkedIn is blue and phone is green. Replies stop everything that remains.
            </p>
          </div>
          <span className="self-start rounded-full border border-sky/40 bg-sky/10 px-3 py-1 font-mono text-[0.5rem] uppercase text-sky">
            {sequence.length} {sequence.length === 1 ? "step" : "steps"}
          </span>
        </div>

        {!disabled ? (
          <div className="mt-4">
            <p className="mb-2 font-mono text-[0.5rem] uppercase tracking-wider text-sky">
              Add the next step only if needed
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {OUTREACH_SEQUENCE_ACTION_TEMPLATES.map((template) => (
                <button
                  type="button"
                  key={template.key}
                  onClick={() => addStep(template)}
                  disabled={sequence.length >= OUTREACH_SEQUENCE_MAX_STEPS}
                  className={`min-h-12 min-w-[8.5rem] shrink-0 rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-35 ${
                    template.channel === "linkedin"
                      ? "border-sky/40 bg-sky/[0.06] hover:bg-sky/10"
                      : template.channel === "phone"
                        ? "border-moss/40 bg-moss/[0.06] hover:bg-moss/10"
                        : "border-amber/40 bg-amber/[0.05] hover:bg-amber/10"
                  }`}
                >
                  <span className={template.channel === "linkedin" ? "mr-2 text-sky" : template.channel === "phone" ? "mr-2 text-moss" : "mr-2 text-amber"}>{template.icon}</span>
                  <span className="font-mono text-[0.52rem] uppercase text-bone">
                    {template.shortLabel}
                  </span>
                  {template.channel !== "email" ? (
                    <span className="mt-1 block font-mono text-[0.44rem] uppercase text-sky">
                      Manual
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              Up to {OUTREACH_SEQUENCE_MAX_STEPS} touches per campaign. LiveCoach automates only approved email delivery. LinkedIn and phone actions require you to complete and confirm them.
            </p>
            <details className="group mt-3 rounded-lg border border-edge bg-panel/45">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-mono text-[0.52rem] uppercase text-muted [&::-webkit-details-marker]:hidden">
                Optional templates and reset
                <span className="text-sky"><span className="group-open:hidden">Open ▾</span><span className="hidden group-open:inline">Close ▴</span></span>
              </summary>
              <div className="space-y-3 border-t border-edge p-3">
                <label className="block">
                  <span className="mb-1 block font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                    Replace with a reusable sequence
                  </span>
                  <select
                    className={field}
                    defaultValue=""
                    onChange={(event) => {
                      applyPreset(event.target.value);
                      event.target.value = "";
                    }}
                  >
                    <option value="" disabled>Choose a template</option>
                    {OUTREACH_SEQUENCE_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name} · {preset.description}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => onChange(defaultOutreachSequence())} className={secondaryButton}>
                  Start again with one email
                </button>
                <p className="text-xs leading-5 text-muted">
                  These controls replace only the unsaved sequence shown here. Press Save sequence to confirm it.
                </p>
              </div>
            </details>
          </div>
        ) : <p className="mt-3 text-xs text-muted">This shared sequence is view only.</p>}
      </div>

      <div className="p-3 sm:p-4">
        {validationError ? (
          <p className="mb-3 rounded-lg border border-rust/45 bg-rust/10 px-3 py-2 text-sm text-rust" role="alert">
            {validationError}
          </p>
        ) : (
          <div className="mb-3 rounded-lg border border-moss/35 bg-moss/[0.06] px-3 py-2 text-xs leading-5 text-moss">
            ✓ Human approval before every email. Any reply stops the remaining steps.
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
            Add the first outreach step above to begin this campaign sequence.
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
