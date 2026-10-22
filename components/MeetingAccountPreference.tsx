"use client";

import { useEffect, useState } from "react";
import { crmFetch } from "@/lib/crm";

const URL = "/api/crm/meeting-preferences";

export default function MeetingAccountPreference() {
  const [email, setEmail] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    crmFetch<{ googleMeetEmail: string }>(URL).then(data => {
      if (!cancelled) { setEmail(data.googleMeetEmail); setLoaded(true); }
    }).catch(() => {
      if (!cancelled) setError("Could not load your meeting preference. Refresh to try again.");
    });
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await crmFetch<{ ok: boolean; googleMeetEmail: string }>(URL, {
        method: "PUT", body: JSON.stringify({ googleMeetEmail: email }),
      });
      if (!data.ok) throw new Error("The preference was not saved");
      setEmail(data.googleMeetEmail);
      setMessage(data.googleMeetEmail
        ? `Google Meet will prefer ${data.googleMeetEmail} when you start a call.`
        : "Google Meet will use your browser's normal account selection.");
    } catch (err: any) { setError(err?.message || "The preference was not saved"); }
    finally { setSaving(false); }
  };

  return (
    <section id="meeting-account" className="mb-5 rounded-xl border border-edge bg-panel/40 p-5">
      <h2 className="font-mono text-[0.65rem] uppercase tracking-wider text-amber">Your Google Meet opening account</h2>
      <p className="mt-2 text-sm text-muted">
        Start call opens Meet using this Google account. Sign into it in the browser you use for LiveCoach.
        This does not change your CRM login, connected calendar, notetaker or Chrome profile.
      </p>
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className="min-w-0 flex-1 text-sm text-bone">
          Google account email
          <input type="email" value={email} disabled={!loaded || saving}
            onChange={event => { setEmail(event.target.value); setMessage(""); }}
            placeholder="Use my browser default" autoComplete="email"
            className="mt-1 block w-full rounded-lg border border-edge bg-ink px-3 py-2 text-bone disabled:opacity-50" />
        </label>
        <button type="submit" disabled={!loaded || saving}
          className="rounded-full border border-amber/60 px-4 py-2 text-sm text-amber disabled:opacity-50">
          {saving ? "Saving…" : "Save meeting account"}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted">Only applies to you. Leave blank to use the browser default. Teams and Zoom are unchanged.</p>
      {error && <p role="alert" className="mt-2 text-sm text-rust">{error}</p>}
      {message && <p role="status" className="mt-2 text-sm text-sage">{message}</p>}
    </section>
  );
}
