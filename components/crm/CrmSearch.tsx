"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { crmFetch } from "@/lib/crm";

type Result = {
  id: string;
  type: string;
  label: string;
  detail: string;
  href: string;
};

const typeTone: Record<string, string> = {
  client: "text-amber",
  contact: "text-sky",
  call: "text-sage",
  task: "text-bone/65",
  opportunity: "text-amber",
  draft: "text-sky",
  playbook: "text-sage",
};

export default function CrmSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);

  useEffect(() => {
    const value = q.trim();
    if (value.length < 2) {
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }
    const id = ++request.current;
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      crmFetch<{ results: Result[] }>(`/api/crm/search?q=${encodeURIComponent(value)}`)
        .then((d) => id === request.current && setResults(d.results || []))
        .catch(() => id === request.current && setError("Search could not load."))
        .finally(() => id === request.current && setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const open = q.trim().length >= 2;

  return (
    <div className="relative z-30 mb-3">
      <div className={`flex items-center gap-2 rounded-xl border bg-panel/70 px-3 py-2 transition ${
        open ? "border-sky/55" : "border-edge focus-within:border-sky/45"
      }`}>
        <span className="font-mono text-sm text-sky">⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQ("")}
          placeholder="Search every client, person, call, task, deal, email or playbook…"
          aria-label="Search the whole CRM"
          className="min-w-0 flex-1 bg-transparent font-sans text-sm text-bone outline-none placeholder:text-muted"
        />
        {loading ? <span className="font-mono text-[0.54rem] uppercase text-muted">searching…</span> : null}
        {q ? (
          <button type="button" onClick={() => setQ("")} aria-label="clear search" className="text-muted hover:text-bone">×</button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] max-h-[28rem] overflow-y-auto rounded-xl border border-edge bg-panel p-2 shadow-2xl shadow-black/40">
          {error ? <p className="px-2 py-3 font-sans text-sm text-rust">{error}</p> : null}
          {!loading && !error && results.length === 0 ? (
            <p className="px-2 py-3 font-sans text-sm text-muted">No matching CRM records.</p>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {results.map((result) => (
              <li key={result.id}>
                <Link
                  href={result.href}
                  onClick={() => setQ("")}
                  className="block rounded-lg px-3 py-2 transition hover:bg-bone/[0.06]"
                >
                  <span className={`font-mono text-[0.5rem] uppercase tracking-wider ${typeTone[result.type] || "text-muted"}`}>
                    {result.type}
                  </span>
                  <span className="ml-2 font-sans text-[0.86rem] text-bone">{result.label}</span>
                  {result.detail ? (
                    <span className="mt-0.5 block truncate font-sans text-[0.72rem] text-muted">{result.detail}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
