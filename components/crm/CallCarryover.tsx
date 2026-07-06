"use client";

import { useEffect, useState } from "react";
import { crmFetch, getCached } from "@/lib/crm";

type LastCall = {
  date: string | null;
  headline: string;
  overview: string;
  myNextActions: string[];
  theirNextActions: string[];
} | null;

type Carryover = {
  lastCall: LastCall;
  checklist: string[];
  openItems: string[];
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  } catch {
    return "";
  }
};

// "Continuing from last time" - the running context for a recurring call so it
// never starts fresh: last call recap, the open items carried forward from the
// AI summaries, and a standing checklist the user maintains and reuses. Shown on
// the call screen when a client is linked.
export default function CallCarryover({
  companyId,
}: {
  companyId: string;
}) {
  const url = `/api/crm/companies/${companyId}/carryover`;
  const seed = getCached<Carryover>(url);
  const [data, setData] = useState<Carryover | null>(seed || null);
  const [loaded, setLoaded] = useState(!!seed);
  const [open, setOpen] = useState(true);
  const [checklist, setChecklist] = useState<string[]>(seed?.checklist || []);
  const [newItem, setNewItem] = useState("");
  // Ephemeral tick state (per call, not saved) - the standing list is reused
  // every time, so ticking is just to track coverage during this call.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!companyId) return;
    crmFetch<Carryover>(url)
      .then((d) => {
        setData(d);
        setChecklist(Array.isArray(d.checklist) ? d.checklist : []);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const persist = (next: string[]) => {
    setChecklist(next);
    crmFetch(url, {
      method: "PUT",
      body: JSON.stringify({ checklist: next }),
    }).catch(() => {});
  };

  const addItem = () => {
    const t = newItem.trim();
    if (!t) return;
    persist([...checklist, t]);
    setNewItem("");
  };
  const editItem = (i: number, v: string) => {
    const next = checklist.slice();
    next[i] = v;
    setChecklist(next); // local while typing
  };
  const commitEdit = () => {
    // Trim everything and drop any item left blank, then save the list.
    persist(checklist.map((s) => s.trim()).filter(Boolean));
  };
  const removeItem = (i: number) => {
    persist(checklist.filter((_, idx) => idx !== i));
  };

  const toggle = (key: string) =>
    setTicked((p) => ({ ...p, [key]: !p[key] }));

  const last = data?.lastCall || null;
  const openItems = data?.openItems || [];

  const hasAnything =
    !!last || openItems.length > 0 || checklist.length > 0 || loaded;
  if (!hasAnything) return null;

  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-sky/30 bg-sky/[0.04]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left"
      >
        <span className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-sky">
          ⟲ Continuing from last time
        </span>
        {last?.date && (
          <span className="font-mono text-[0.56rem] text-muted">
            last call {fmtDate(last.date)}
          </span>
        )}
        <span className="ml-auto font-mono text-[0.58rem] uppercase tracking-wider text-muted">
          {open ? "▾ hide" : "▸ show"}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-sky/20 px-4 py-3">
          {/* RECAP of the last call */}
          {last ? (
            <div>
              {last.headline && (
                <p className="font-sans text-[0.86rem] leading-snug text-bone">
                  {last.headline}
                </p>
              )}
              {last.overview && (
                <p className="mt-1 font-sans text-[0.8rem] leading-relaxed text-bone/70">
                  {last.overview}
                </p>
              )}
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {last.myNextActions.length > 0 && (
                  <div>
                    <p className="mb-1 font-mono text-[0.52rem] uppercase tracking-[0.16em] text-amber">
                      You said you'd
                    </p>
                    <ul className="flex flex-col gap-0.5">
                      {last.myNextActions.map((t, i) => (
                        <li
                          key={i}
                          className="font-sans text-[0.78rem] leading-snug text-bone/80"
                        >
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {last.theirNextActions.length > 0 && (
                  <div>
                    <p className="mb-1 font-mono text-[0.52rem] uppercase tracking-[0.16em] text-sky">
                      They were doing
                    </p>
                    <ul className="flex flex-col gap-0.5">
                      {last.theirNextActions.map((t, i) => (
                        <li
                          key={i}
                          className="font-sans text-[0.78rem] leading-snug text-bone/80"
                        >
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ) : (
            loaded && (
              <p className="font-mono text-[0.68rem] text-muted">
                No previous call recorded for this client yet. After your first
                call here, the recap and open items show up automatically.
              </p>
            )
          )}

          {/* CARRIED open items from the AI summaries (the evolving list) */}
          {openItems.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-[0.52rem] uppercase tracking-[0.16em] text-sage">
                Open items carried forward
              </p>
              <ul className="flex flex-col gap-1">
                {openItems.map((t, i) => {
                  const key = `open:${i}`;
                  return (
                    <li key={key} className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        aria-label="tick"
                        className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded border text-[0.5rem] leading-none transition ${
                          ticked[key]
                            ? "border-sage bg-sage text-ink"
                            : "border-edge text-transparent hover:border-sage/60"
                        }`}
                      >
                        ✓
                      </button>
                      <span
                        className={`font-sans text-[0.8rem] leading-snug ${
                          ticked[key]
                            ? "text-muted line-through"
                            : "text-bone/85"
                        }`}
                      >
                        {t}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* STANDING checklist the user maintains and reuses every time */}
          <div>
            <p className="mb-1 font-mono text-[0.52rem] uppercase tracking-[0.16em] text-bone/70">
              Your standing checklist
            </p>
            <ul className="flex flex-col gap-1">
              {checklist.map((t, i) => {
                const key = `chk:${i}`;
                return (
                  <li key={i} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      aria-label="tick"
                      className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border text-[0.5rem] leading-none transition ${
                        ticked[key]
                          ? "border-sage bg-sage text-ink"
                          : "border-edge text-transparent hover:border-sage/60"
                      }`}
                    >
                      ✓
                    </button>
                    <input
                      value={t}
                      onChange={(e) => editItem(i, e.target.value)}
                      onBlur={() => commitEdit()}
                      className={`min-w-0 flex-1 border-none bg-transparent p-0 font-sans text-[0.8rem] leading-snug outline-none ${
                        ticked[key] ? "text-muted line-through" : "text-bone/90"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      aria-label="remove"
                      className="font-mono text-[0.7rem] text-muted transition hover:text-rust"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addItem();
                  }
                }}
                placeholder="Add a standing item you always want to cover…"
                className="min-w-0 flex-1 rounded-md border border-edge bg-ink/50 px-2 py-1 font-sans text-[0.78rem] text-bone outline-none placeholder:text-muted/50 focus:border-sky/60"
              />
              <button
                type="button"
                onClick={addItem}
                disabled={!newItem.trim()}
                className="shrink-0 rounded-md border border-sky/50 bg-sky/10 px-2.5 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-sky transition hover:bg-sky/20 disabled:opacity-40"
              >
                add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
