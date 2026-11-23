"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch } from "@/lib/crm";

type Receipt = { call_id: string; status: string; recipient: string | null; sent_at: string | null; last_error: string | null; created_at: string };
type State = { enabled: boolean; receipts: Receipt[] };
const label = (r: Receipt) => r.status === "sent" ? `Recap emailed to ${r.recipient}`
  : r.status === "uncertain" ? "Delivery needs checking"
  : r.status === "needs_review" ? "Recap held for review"
  : r.status === "skipped" ? "Recap not sent"
  : "Recap email is being prepared";

export default function CallRecapEmails({ callId }: { callId?: string }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const url = `/api/crm/call-recap-emails${callId ? `?callId=${encodeURIComponent(callId)}` : ""}`;
  useEffect(() => {
    let cancelled = false;
    crmFetch<State>(url).then(d => { if (!cancelled) setState(d); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [url]);
  async function change() {
    if (!state) return;
    setSaving(true); setError("");
    try {
      const result = await crmFetch<{ ok: boolean; enabled: boolean }>("/api/crm/call-recap-emails", { method: "PUT", body: JSON.stringify({ enabled: !state.enabled }) });
      if (!result.ok) throw new Error("The preference change was not confirmed. Reopen Settings to check it.");
      setState({ ...state, enabled: result.enabled });
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  }
  return <section id="call-recap-emails" className="my-5 rounded-xl border border-edge bg-panel/40 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-serif text-xl text-bone">Call recap emails</h2>
      {!callId && <button type="button" aria-pressed={state?.enabled || false} disabled={!state || saving} onClick={change}
        className="rounded-full border border-amber/60 px-4 py-2 text-sm text-amber disabled:opacity-50">
        {saving ? "Saving…" : !state ? "Loading preference…" : state.enabled ? "On · turn off" : "Off · turn on"}
      </button>}
    </div>
    <p className="mt-2 text-sm leading-relaxed text-muted">A friendly recap with key points and agreed next actions, emailed only to your own connected mailbox after new calls finish. Usually within five minutes of the summary being saved. Review before forwarding.</p>
    {!callId && <p className="mt-2 text-sm text-muted">Private notes, coaching scores and internal CRM context are excluded. Prospects are never emailed automatically. This preference applies only to your account.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-rust">{error}</p>}
    {state && !state.enabled && <p className="mt-3 text-sm text-muted">Automatic recap emails are off for your account. {callId && <Link href="/settings#call-recap-emails" className="text-amber underline">Manage in Settings</Link>}</p>}
    {state?.receipts.map(r => <div key={r.call_id} className="mt-3 border-t border-edge pt-3 text-sm">
      {!callId ? <Link href={`/crm/calls/${r.call_id}`} className="text-amber underline">{label(r)}</Link> : <p className="text-sage">{label(r)}</p>}
      <p className="mt-1 text-xs text-muted">{new Date(r.sent_at || r.created_at).toLocaleString("en-GB")}</p>
      {r.last_error && <p className="mt-1 text-muted">{r.last_error}</p>}
    </div>)}
  </section>;
}
