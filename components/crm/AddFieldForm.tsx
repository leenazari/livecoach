"use client";

import { useState } from "react";
import { crmFetch, type FieldDefinition, type FieldType } from "@/lib/crm";

const TYPES: FieldType[] = [
  "text",
  "number",
  "currency",
  "date",
  "select",
  "multiselect",
  "url",
  "boolean",
];

// Add a new custom (Lego) field to the registry for an entity. On success the
// parent re-fetches definitions so the field appears on every record.
export default function AddFieldForm({
  entity,
  onAdded,
}: {
  entity: "company" | "contact";
  onAdded: (field: FieldDefinition) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [optionsText, setOptionsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const needsOptions = type === "select" || type === "multiselect";

  const submit = async () => {
    if (!label.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const options = needsOptions
        ? optionsText
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : [];
      const { field } = await crmFetch<{ field: FieldDefinition }>(
        "/api/crm/fields",
        {
          method: "POST",
          body: JSON.stringify({ entity, label: label.trim(), type, options }),
        }
      );
      onAdded(field);
      setLabel("");
      setType("text");
      setOptionsText("");
      setOpen(false);
    } catch (e: any) {
      setErr(e.message || "could not add the field");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-edge px-3 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
      >
        + add custom field
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-edge bg-ink/40 p-3.5">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Field label (e.g. Net worth)"
          className="rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none focus:border-amber/60"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as FieldType)}
          className="rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none focus:border-amber/60"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {needsOptions && (
        <input
          value={optionsText}
          onChange={(e) => setOptionsText(e.target.value)}
          placeholder="Options, comma-separated (e.g. Low, Medium, High)"
          className="rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none focus:border-amber/60"
        />
      )}
      {err && (
        <p className="font-mono text-[0.62rem] text-rust">{err}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !label.trim()}
          className="rounded-full border border-amber/60 bg-amber/15 px-4 py-1.5 font-mono text-[0.6rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
        >
          {busy ? "adding…" : "add field"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setErr("");
          }}
          className="rounded-full border border-edge px-4 py-1.5 font-mono text-[0.6rem] uppercase tracking-wider text-muted transition hover:text-bone"
        >
          cancel
        </button>
      </div>
    </div>
  );
}
