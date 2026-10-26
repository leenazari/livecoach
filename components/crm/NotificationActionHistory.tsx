"use client";
import { useCallback, useEffect, useState } from "react";
import { crmFetch } from "@/lib/crm";
type Item = { id: string; title: string; content: string; company_id: string | null; created_at: string };

export default function NotificationActionHistory() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (offset = 0) => {
    setLoading(true); setError("");
    try {
      const result = await crmFetch<{ items: Item[]; hasMore: boolean }>(`/api/crm/notifications/actions?offset=${offset}`);
      setItems(current => offset ? [...current, ...result.items] : result.items); setHasMore(result.hasMore);
    } catch { setError("Your saved actions could not be loaded. Try again."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (!open) return;
    void load();
    const refresh = () => void load();
    window.addEventListener("lc:client-activity-updated", refresh);
    return () => window.removeEventListener("lc:client-activity-updated", refresh);
  }, [open, load]);
  return <section className="mb-4 rounded-xl border border-edge bg-panel/60 p-4">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="min-h-11 text-sm text-bone">
      {open ? "▾" : "▸"} Your action log
    </button>
    {open ? <div className="mt-2 space-y-3">
      <p className="text-xs text-muted">Your completed actions and notes, kept after their notifications are cleared.</p>
      {items.map(item => <article key={item.id} className="rounded-lg border border-edge p-3">
        <p className="text-sm font-medium text-bone">{item.title}</p>
        <time className="text-xs text-muted">{new Date(item.created_at).toLocaleString("en-GB")}</time>
        <p className="mt-2 whitespace-pre-wrap text-sm text-bone/80">{item.content}</p>
        {item.company_id ? <a className="mt-2 inline-block min-h-10 text-sm text-sky underline" href={`/crm/${item.company_id}`}>View client</a> : null}
      </article>)}
      {!loading && !items.length && !error ? <p className="text-sm text-muted">Use Done or Log action on a notification to start your action log.</p> : null}
      {loading ? <p role="status" className="text-sm text-muted">Loading your actions…</p> : null}
      {error ? <p role="alert" className="text-sm text-rust">{error}</p> : null}
      {hasMore || error ? <button type="button" disabled={loading} onClick={() => void load(error ? 0 : items.length)}
        className="min-h-11 rounded-lg border border-edge px-4 text-sm text-bone disabled:opacity-45">{error ? "Try again" : "Show more"}</button> : null}
    </div> : null}
  </section>;
}
