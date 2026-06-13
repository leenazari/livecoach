"use client";

import type { FieldDefinition } from "@/lib/crm";

// Renders ONE custom (Lego) field as the right input for its type. Controlled:
// the parent owns the value and persists it into the record's `attributes`.
export default function CustomFieldEditor({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: any;
  onChange: (v: any) => void;
}) {
  const inputCls =
    "w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60";

  const label = (
    <span className="mb-1 block font-mono text-[0.58rem] uppercase tracking-[0.16em] text-muted">
      {field.label}
    </span>
  );

  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-amber"
        />
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-bone/80">
          {field.label}
        </span>
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label className="block">
        {label}
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "multiselect") {
    const arr: string[] = Array.isArray(value) ? value : [];
    const toggle = (o: string) =>
      onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]);
    return (
      <div>
        {label}
        <div className="flex flex-wrap gap-1.5">
          {field.options.map((o) => {
            const on = arr.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => toggle(o)}
                className={`rounded-full border px-2.5 py-1 font-mono text-[0.62rem] transition ${
                  on
                    ? "border-amber/60 bg-amber/15 text-amber"
                    : "border-edge text-muted hover:text-bone"
                }`}
              >
                {o}
              </button>
            );
          })}
          {field.options.length === 0 && (
            <span className="font-mono text-[0.6rem] text-muted">
              no options defined
            </span>
          )}
        </div>
      </div>
    );
  }

  const inputType =
    field.type === "number" || field.type === "currency"
      ? "number"
      : field.type === "date"
      ? "date"
      : field.type === "url"
      ? "url"
      : "text";

  return (
    <label className="block">
      {label}
      <input
        type={inputType}
        value={value ?? ""}
        onChange={(e) =>
          onChange(
            field.type === "number" || field.type === "currency"
              ? e.target.value === ""
                ? ""
                : Number(e.target.value)
              : e.target.value
          )
        }
        placeholder={field.type === "currency" ? "£" : ""}
        className={inputCls}
      />
    </label>
  );
}
