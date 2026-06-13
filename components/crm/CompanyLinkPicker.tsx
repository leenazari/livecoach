"use client";

import { useEffect, useRef, useState } from "react";
import { crmFetch, type Company } from "@/lib/crm";

// Compact picker to LINK the current call to a CRM company. Search + select, or
// create on the fly. Shows the linked company as a chip with a link to open it.
export default function CompanyLinkPicker({
  value,
  onChange,
}: {
  value: { id: string; name: string } | null;
  onChange: (v: { id: string; name: string } | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Company[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || q.trim().length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { companies } = await crmFetch<{ companies: Company[] }>(
          `/api/crm/companies?q=${encodeURIComponent(q.trim())}`
        );
        setResults(companies.slice(0, 6));
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (c: Company) => {
    onChange({ id: c.id, name: c.name });
    setQ("");
    setOpen(false);
  };

  const createAndPick = async () => {
    const name = q.trim();
    if (!name) return;
    setBusy(true);
    try {
      const { company } = await crmFetch<{ company: Company }>(
        "/api/crm/companies",
        { method: "POST", body: JSON.stringify({ name }) }
      );
      pick(company);
    } catch {
      /* ignore - keep the picker open */
    } finally {
      setBusy(false);
    }
  };

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-sky/50 bg-sky/10 px-3 py-1.5 font-mono text-[0.62rem] text-sky">
          {"◆"} {value.name}
        </span>
        <a
          href={`/crm/${value.id}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:text-amber"
        >
          open ↗
        </a>
        <button
          type="button"
          onClick={() => onChange(null)}
          title="unlink"
          className="rounded px-1.5 py-0.5 font-mono text-[0.7rem] text-muted transition hover:text-rust"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-sm">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Link to a client…"
        className="w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none transition placeholder:text-muted/50 focus:border-sky/60"
      />
      {open && q.trim() && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-edge bg-panel shadow-lg">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(c)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-ink/60"
            >
              <span className="truncate font-sans text-sm text-bone">
                {c.name}
              </span>
              <span className="shrink-0 font-mono text-[0.55rem] uppercase tracking-wider text-muted">
                {c.sector || ""}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={createAndPick}
            disabled={busy}
            className="flex w-full items-center gap-2 border-t border-edge px-3 py-2 text-left font-mono text-[0.62rem] uppercase tracking-wider text-sage transition hover:bg-ink/60 disabled:opacity-40"
          >
            {busy ? "creating…" : `+ create "${q.trim()}"`}
          </button>
        </div>
      )}
    </div>
  );
}
