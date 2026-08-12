"use client";

import { useEffect, useRef, useState } from "react";
import { crmFetch, type Company } from "@/lib/crm";

// Compact picker to LINK the current call to a CRM company. Search + select, or
// create on the fly. Shows the linked company as a chip with a link to open it.
export default function CompanyLinkPicker({
  value,
  onChange,
  suggestedName,
}: {
  value: { id: string; name: string } | null;
  onChange: (v: { id: string; name: string } | null) => void;
  suggestedName?: string | null;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Company[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
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
    const name = (creating ? newName : q).trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      const { company } = await crmFetch<{ company: Company }>(
        "/api/crm/companies",
        { method: "POST", body: JSON.stringify({ name, stage: "New" }) }
      );
      pick(company);
      setCreating(false);
      setNewName("");
    } catch (e: any) {
      setError(e?.message || "That client could not be created. Try again.");
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
      {creating ? (
        <div className="rounded-lg border border-sage/40 bg-sage/[0.06] p-2.5">
          <p className="mb-2 font-mono text-[0.55rem] uppercase tracking-wider text-sage">
            Add new client and attach this call
          </p>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createAndPick();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Client or contact name"
            className="w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none transition placeholder:text-muted/50 focus:border-sage/60"
          />
          {error && (
            <p className="mt-1.5 font-mono text-[0.55rem] text-rust">{error}</p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={createAndPick}
              disabled={busy || !newName.trim()}
              className="rounded-full border border-sage/50 bg-sage/10 px-3 py-1.5 font-mono text-[0.56rem] uppercase tracking-wider text-sage transition hover:bg-sage/20 disabled:opacity-40"
            >
              {busy ? "creating…" : "create and attach"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setError("");
              }}
              className="rounded-full border border-edge px-3 py-1.5 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:text-bone"
            >
              cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Find an existing client…"
            className="min-w-0 flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none transition placeholder:text-muted/50 focus:border-sky/60"
          />
          <button
            type="button"
            onClick={() => {
              setNewName((suggestedName || q).trim());
              setCreating(true);
              setOpen(false);
              setError("");
            }}
            className="shrink-0 rounded-lg border border-sage/50 bg-sage/10 px-2.5 py-2 font-mono text-[0.54rem] uppercase tracking-wider text-sage transition hover:bg-sage/20"
          >
            + new client
          </button>
        </div>
      )}
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
            onClick={() => {
              setNewName(q.trim());
              setCreating(true);
              setOpen(false);
              setError("");
            }}
            className="flex w-full items-center gap-2 border-t border-edge px-3 py-2 text-left font-mono text-[0.62rem] uppercase tracking-wider text-sage transition hover:bg-ink/60 disabled:opacity-40"
          >
            {`+ add "${q.trim()}" as a new client`}
          </button>
        </div>
      )}
    </div>
  );
}
