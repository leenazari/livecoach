"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { crmFetch, getCached } from "@/lib/crm";
import CompanyLinkPicker from "@/components/crm/CompanyLinkPicker";

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

  // Open the call screen preloaded from this scheduled call.
  const start = (c: Upcoming) => {
    const qs = new URLSearchParams();
    if (c.company_id) qs.set("company", c.company_id);
    if (c.company) qs.set("companyName", c.company);
    if (c.intent) qs.set("intent", c.intent);
    if (c.meeting_url) qs.set("meetingUrl", c.meeting_url);
    router.push(`/call${qs.toString() ? `?${qs.toString()}` : ""}`);
  };

  const inputCls =
    "w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-[0.72rem] text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60";

  return (
    <div className="rounded-xl border border-edge bg-panel/40 p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          {"▦"} Upcoming calls
        </p>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          {adding ? "close" : "+ schedule"}
        </button>
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
          <textarea
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            rows={2}
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
        <ul className="flex flex-col gap-2">
          {calls.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border border-edge bg-ink/40 px-3.5 py-3"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
                  onClick={() => patch(c.id, { prepped: !c.prepped })}
                  title={c.prepped ? "marked prepped - click to unset" : "mark prepped"}
                  className={`rounded-full px-3 py-1 font-mono text-[0.54rem] uppercase tracking-wider transition ${
                    c.prepped
                      ? "border border-sky bg-sky text-ink"
                      : "border border-edge text-muted hover:text-bone"
                  }`}
                >
                  {c.prepped ? "✓ prepped" : "prep"}
                </button>
                <button
                  type="button"
                  onClick={() => start(c)}
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
      )}
    </div>
  );
}
