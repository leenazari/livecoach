"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { crmFetch, getCached } from "@/lib/crm";
import CompanyLinkPicker from "@/components/crm/CompanyLinkPicker";
import VoiceNoteButton from "@/components/VoiceNoteButton";

type Upcoming = {
  id: string;
  company_id: string | null;
  company: string | null;
  title: string | null;
  scheduled_at: string | null;
  meeting_url: string | null;
  intent: string | null;
  prepped: boolean;
};

const fmtWhen = (iso: string | null) => {
  if (!iso) return "no time set";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

export default function UpcomingCalls() {
  const router = useRouter();
  const cached = getCached<{ calls: Upcoming[] }>("/api/crm/upcoming");
  const [calls, setCalls] = useState<Upcoming[]>(cached?.calls || []);
  const [adding, setAdding] = useState(false);
  const [prepId, setPrepId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [showAll, setShowAll] = useState(false);

  // add-form state
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState<{ id: string; name: string } | null>(
    null
  );
  const [when, setWhen] = useState("");
  const [url, setUrl] = useState("");
  const [intent, setIntent] = useState("");

  const load = () =>
    crmFetch<{ calls: Upcoming[] }>("/api/crm/upcoming")
      .then((d) => setCalls(d.calls || []))
      .catch(() => {});

  // Pull the latest from Google now (catches reschedules between the automatic
  // syncs). Needs Google connected in Settings.
  const syncNow = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      const r = await crmFetch<{ added: number; updated: number }>(
        "/api/crm/calendar-sync",
        { method: "POST" }
      );
      await load();
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      const bits: string[] = [];
      if (r.added) bits.push(`${r.added} new`);
      if (r.updated) bits.push(`${r.updated} updated`);
      setSyncMsg(bits.length ? `synced - ${bits.join(", ")}` : "already up to date");
    } catch (e: any) {
      setSyncMsg(e?.message || "sync failed");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!title.trim() && !company) return;
    await crmFetch("/api/crm/upcoming", {
      method: "POST",
      body: JSON.stringify({
        title: title.trim(),
        companyId: company?.id || null,
        scheduledAt: when ? new Date(when).toISOString() : null,
        meetingUrl: url.trim(),
        intent: intent.trim(),
      }),
    }).catch(() => {});
    setTitle("");
    setCompany(null);
    setWhen("");
    setUrl("");
    setIntent("");
    setAdding(false);
    load();
  };

  const patch = async (id: string, body: any) => {
    setCalls((p) => p.map((c) => (c.id === id ? { ...c, ...body } : c)));
    await crmFetch(`/api/crm/upcoming/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).catch(() => {});
  };

  const remove = async (id: string) => {
    setCalls((p) => p.filter((c) => c.id !== id));
    crmFetch(`/api/crm/upcoming/${id}`, { method: "DELETE" }).catch(() => {});
  };

  // Open the call screen preloaded from this scheduled call. The /call screen IS
  // the prep screen: it opens at the plan stage with this client, intent and link
  // already loaded, and only goes live when speech starts or you hit Go live. Both
  // "prep" and "start" route here - prep = prepare ahead, start = jump in now.
  const openCall = (c: Upcoming) => {
    const qs = new URLSearchParams();
    if (c.company_id) qs.set("company", c.company_id);
    if (c.company) qs.set("companyName", c.company);
    if (c.intent) qs.set("intent", c.intent);
    if (c.meeting_url) qs.set("meetingUrl", c.meeting_url);
    // Tie this session to the scheduled call so the plan you build saves against
    // it and reloads next time you open prep.
    qs.set("upcoming", c.id);
    router.push(`/call${qs.toString() ? `?${qs.toString()}` : ""}`);
  };

  const inputCls =
    "w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-[0.72rem] text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60";

  // Default to the next 7 days, with the rest behind an expand button (the list
  // gets long once the calendar is synced). Untimed calls stay in the default view.
  const sevenDayCutoff = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const within7 = calls.filter(
    (c) => !c.scheduled_at || new Date(c.scheduled_at).getTime() <= sevenDayCutoff
  );
  const later = calls.filter(
    (c) => c.scheduled_at && new Date(c.scheduled_at).getTime() > sevenDayCutoff
  );
  const shown = showAll ? calls : within7;

  return (
    <div className="rounded-xl border border-edge bg-panel/40 p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          {"▦"} Upcoming calls
        </p>
        <div className="flex items-center gap-2">
          {syncMsg && (
            <span className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
              {syncMsg}
            </span>
          )}
          <button
            type="button"
            onClick={syncNow}
            disabled={syncing}
            title="Pull the latest from your Google calendar now"
            className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-sky/50 hover:text-sky disabled:opacity-40"
          >
            {syncing ? "syncing…" : "⟳ sync"}
          </button>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
          >
            {adding ? "close" : "+ schedule"}
          </button>
        </div>
      </div>

      {adding && (
        <div className="mb-3 flex flex-col gap-2 rounded-lg border border-amber/30 bg-amber/[0.04] p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Call title, e.g. Onboarding sync"
            className={inputCls}
          />
          <div className="flex flex-wrap items-center gap-2">
            <CompanyLinkPicker value={company} onChange={setCompany} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={inputCls}
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Meet / Teams / Zoom link (optional)"
              className={inputCls}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[0.54rem] uppercase tracking-wider text-muted">
              intent
            </span>
            <span className="ml-auto">
              <VoiceNoteButton
                onText={(t) =>
                  setIntent((p) => (p.trim() ? `${p.trim()} ${t}` : t))
                }
              />
            </span>
          </div>
          <textarea
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            rows={4}
            placeholder="What do you want from this call? (you can prep this later too)"
            className={`${inputCls} resize-y font-sans text-sm`}
          />
          <button
            type="button"
            onClick={create}
            disabled={!title.trim() && !company}
            className="self-start rounded-full border border-amber/60 bg-amber/15 px-4 py-1.5 font-mono text-[0.6rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
          >
            schedule call
          </button>
        </div>
      )}

      {calls.length === 0 ? (
        <p className="font-mono text-[0.62rem] leading-relaxed text-muted">
          Nothing scheduled. Add an upcoming call to prep it in advance and jump
          straight in when it's time. (Google Calendar sync comes next.)
        </p>
      ) : (
        <>
        <ul className="flex flex-col gap-2">
          {shown.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border border-edge bg-ink/40 px-3.5 py-3"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  type="button"
                  onClick={() => patch(c.id, { prepped: !c.prepped })}
                  title={c.prepped ? "prepped - click to unset" : "mark as prepped"}
                  aria-label="toggle prepped"
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[0.6rem] leading-none transition ${
                    c.prepped
                      ? "border-sky bg-sky text-ink"
                      : "border-edge text-muted hover:border-sky/60 hover:text-bone"
                  }`}
                >
                  {c.prepped ? "✓" : ""}
                </button>
                <span className="font-mono text-[0.6rem] uppercase tracking-wider text-sky">
                  {fmtWhen(c.scheduled_at)}
                </span>
                <span className="flex-1 font-sans text-[0.9rem] text-bone">
                  {c.title || "Untitled call"}
                  {c.company && (
                    <span className="ml-1.5 font-mono text-[0.6rem] text-muted">
                      · {c.company}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => openCall(c)}
                  title="Open the prep screen for this call: build the plan, load docs, set your focus. It saves against this call."
                  className="rounded-full border border-amber/60 bg-amber/15 px-3 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-amber transition hover:bg-amber/25"
                >
                  prep ▸
                </button>
                <button
                  type="button"
                  onClick={() => openCall(c)}
                  title="Jump straight into the live call (same screen, ready to go)"
                  className="rounded-full border border-sage/60 bg-sage/15 px-3 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-sage transition hover:bg-sage/25"
                >
                  start ▸
                </button>
                <button
                  type="button"
                  onClick={() => setPrepId(prepId === c.id ? "" : c.id)}
                  className="font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:text-amber"
                >
                  {prepId === c.id ? "hide" : "edit"}
                </button>
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  title="delete"
                  className="font-mono text-[0.7rem] text-muted transition hover:text-rust"
                >
                  ✕
                </button>
              </div>

              {prepId === c.id && (
                <div className="mt-2.5 flex flex-col gap-2 border-t border-edge/50 pt-2.5">
                  <textarea
                    defaultValue={c.intent || ""}
                    rows={2}
                    placeholder="Intent / what you want from this call"
                    onBlur={(e) => patch(c.id, { intent: e.target.value })}
                    className={`${inputCls} resize-y font-sans text-sm`}
                  />
                  <input
                    defaultValue={c.meeting_url || ""}
                    placeholder="Meeting link"
                    onBlur={(e) => patch(c.id, { meetingUrl: e.target.value })}
                    className={inputCls}
                  />
                  <p className="font-mono text-[0.54rem] leading-relaxed text-muted">
                    Saved when you click away. Set the intent here, then mark it
                    prepped - Start opens the call with this client, link and
                    intent already loaded.
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
        {shown.length === 0 && (
          <p className="font-mono text-[0.62rem] leading-relaxed text-muted">
            Nothing in the next 7 days.
          </p>
        )}
        {later.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-2.5 w-full rounded-lg border border-edge px-3 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
          >
            {showAll ? "show less" : `+ ${later.length} more beyond 7 days`}
          </button>
        )}
        </>
      )}
    </div>
  );
}
