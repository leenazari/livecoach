"use client";
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { crmFetch } from '@/lib/crm';
import NavMenu from '@/components/crm/NavMenu';
type Log = { id: string; actor_user_id: string; actor_role: string; source: string; event_type: string; status: string; created_at: string; expires_at: string; request_payload: Record<string, unknown>; response_payload: Record<string, unknown>; error: string | null; truncations: string[] };
type Audit = { logs: Log[]; users: { user_id: string; display_name: string | null; email: string | null }[]; nextCursor: string | null; retentionDays: number };
export default function BrainAuditPage() {
  const [data, setData] = useState<Audit | null>(null);
  const [actor, setActor] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  const load = useCallback(async (cursor?: string) => {
    const version = ++requestVersion.current;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (actor) params.set('actor', actor);
      if (cursor) params.set('cursor', cursor);
      const next = await crmFetch<Audit>(`/api/crm/brain-audit?${params}`);
      if (version === requestVersion.current) setData(previous => cursor && previous ? { ...next, logs: [...previous.logs, ...next.logs] } : next);
    } catch (failure) {
      if (version === requestVersion.current) { setData(null); setError(failure instanceof Error ? failure.message : 'Audit logs could not be loaded'); }
    } finally { if (version === requestVersion.current) setLoading(false); }
  }, [actor]);
  useEffect(() => { setData(null); void load(); return () => { requestVersion.current++; }; }, [load]);
  const names = new Map(data?.users.map(user => [user.user_id, user.display_name || user.email || user.user_id]));
  return <main className="mx-auto max-w-5xl space-y-6 p-5 text-bone">
    <NavMenu />
    <div className="space-y-2">
      <Link href="/crm/brain-control" className="text-sm text-amber">← Brain control</Link>
      <h1 className="text-2xl font-semibold">Brain server audit</h1>
      <p className="text-sm text-muted">Workspace owner only. Audit copies expire after 30 days and are cleared automatically. Personal Brain conversations and memory stay with each account.</p>
    </div>
    {data && <label className="block text-sm">Account
      <select value={actor} onChange={event => setActor(event.target.value)} className="ml-3 rounded-lg border border-edge bg-panel p-2">
        <option value="">All workspace accounts</option>
        {data.users.map(user => <option key={user.user_id} value={user.user_id}>{user.display_name || user.email || user.user_id}</option>)}
      </select>
    </label>}
    {error && <p role="alert" className="text-rust">{error} <button onClick={() => void load()} className="underline">Try again</button></p>}
    {loading && <p role="status" className="text-muted">Loading audit logs…</p>}
    {data && !data.logs.length && <p className="text-muted">No audit entries in the last 30 days for this selection. Logging begins with this release.</p>}
    <div className="space-y-3">{data?.logs.map(log => <article key={log.id} className="rounded-xl border border-edge bg-panel p-4">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <strong>{names.get(log.actor_user_id) || log.actor_user_id}</strong>
        <time dateTime={log.created_at}>{new Date(log.created_at).toLocaleString()}</time>
      </div>
      <p className="mt-1 text-sm text-muted">{log.event_type.replaceAll('_', ' ')} · {log.status} · {log.source} · {log.actor_role}</p>
      {log.error && <p className="mt-2 text-sm text-rust">{log.error}</p>}
      <details className="mt-3 text-sm"><summary className="cursor-pointer text-amber">Request and response</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink p-3">{JSON.stringify({ request: log.request_payload, response: log.response_payload }, null, 2)}</pre>
        {log.truncations.length > 0 && <p className="text-muted">Content limits applied to: {log.truncations.join(', ')}</p>}
        <p className="mt-2 text-muted">Expires {new Date(log.expires_at).toLocaleString()}</p>
      </details>
    </article>)}</div>
    {data?.nextCursor && <button disabled={loading} onClick={() => void load(data.nextCursor!)} className="rounded-lg border border-edge px-4 py-2 disabled:opacity-50">Load older entries</button>}
  </main>;
}
