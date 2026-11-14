"use client";

import { useCallback, useEffect, useState } from "react";

import { CrmRequestError, crmFetch } from "@/lib/crm";
import { INTERVIEWER_VOICES } from "@/lib/interviewer/voices";

type Campaign = {
  id: string;
  name: string;
  voice_id: string;
  max_minutes: number | null;
  rate_per_minute: number;
  currency: string;
  margin_percent: number;
  billing_granularity: "second" | "minute";
  interviewer_documents?: Array<{ id: string; title: string }>;
};

type SessionRow = {
  id: string;
  status: string;
  billable_seconds: number | null;
  billed_amount: number | null;
  disposition: string | null;
  reason_code: string | null;
  timing_target_date: string | null;
  timing_precision: string | null;
  timing_raw_quote: string | null;
  calendar_event_id: string | null;
  calendar_scheduled_at: string | null;
  hasRecording: boolean;
  created_at: string;
};

type Utterance = { id: string; speaker: "agent" | "lead"; text: string; ts: string };

export default function OwnerConsole() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState<{ session: SessionRow; utterances: Utterance[] } | null>(null);
  const [recordingUrl, setRecordingUrl] = useState("");
  const [invitePath, setInvitePath] = useState("");
  const [notice, setNotice] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [name, setName] = useState("");
  const [voiceId, setVoiceId] = useState<string>(INTERVIEWER_VOICES[1].id);
  const [maxMinutes, setMaxMinutes] = useState("");
  const [rate, setRate] = useState("0");
  const [currency, setCurrency] = useState("GBP");
  const [margin, setMargin] = useState("0");
  const [granularity, setGranularity] = useState("second");
  const [prospectName, setProspectName] = useState("");
  const [prospectEmail, setProspectEmail] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docBody, setDocBody] = useState("");

  const explain = (error: unknown) => {
    if (error instanceof CrmRequestError) setNotice(error.message);
    else setNotice("The interviewer page could not complete that action. Check the latest record before trying again.");
  };

  const load = useCallback(async () => {
    const data = await crmFetch<{ campaigns: Campaign[] }>("/api/crm/interviewer/campaigns");
    setCampaigns(data.campaigns || []);
    const current = campaignId || data.campaigns?.[0]?.id || "";
    if (!campaignId && current) setCampaignId(current);
    if (current) {
      const rows = await crmFetch<{ sessions: SessionRow[] }>(`/api/crm/interviewer/sessions?campaignId=${current}`);
      setSessions(rows.sessions || []);
    }
  }, [campaignId]);

  useEffect(() => {
    load().catch(explain);
  }, [load]);

  const createCampaign = async () => {
    setNotice("");
    try {
      const saved = await crmFetch<{ campaign: { id: string } }>("/api/crm/interviewer/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name,
          voiceId,
          maxMinutes: maxMinutes.trim() === "" ? null : Number(maxMinutes),
          ratePerMinute: Number(rate),
          currency,
          marginPercent: Number(margin),
          billingGranularity: granularity,
        }),
      });
      setCampaignId(saved.campaign.id);
      setName("");
      setNotice("Campaign saved.");
      await load();
    } catch (error) {
      explain(error);
    }
  };

  const createInvite = async () => {
    setNotice("");
    setInvitePath("");
    try {
      const invite = await crmFetch<{ path: string; expiresAt: string }>("/api/crm/interviewer/invites", {
        method: "POST",
        body: JSON.stringify({ campaignId, prospectName, prospectEmail, expiresInHours: 24 * 7 }),
      });
      const link = `${window.location.origin}${invite.path}`;
      setInvitePath(link);
      setNotice("Test link created. It expires in 7 days. It has not been emailed.");
    } catch (error) {
      explain(error);
    }
  };

  const saveDocument = async () => {
    setNotice("");
    try {
      await crmFetch("/api/crm/interviewer/documents", {
        method: "POST",
        body: JSON.stringify({ campaignId, title: docTitle, body: docBody }),
      });
      setDocTitle("");
      setDocBody("");
      setNotice("Knowledge note saved.");
      await load();
    } catch (error) {
      explain(error);
    }
  };

  const openSession = async (id: string) => {
    setRecordingUrl("");
    try {
      const detail = await crmFetch<{ session: SessionRow; utterances: Utterance[] }>(`/api/crm/interviewer/sessions/${id}`);
      setSelected(detail);
      if (detail.session.hasRecording) {
        const audio = await crmFetch<{ url: string }>(`/api/crm/interviewer/sessions/${id}/recording`);
        setRecordingUrl(audio.url);
      }
    } catch (error) {
      explain(error);
    }
  };

  return (
    <main className="relative z-10 mx-auto max-w-5xl px-5 py-10">
      <p className="font-mono text-[0.68rem] uppercase tracking-[0.22em] text-amber">Hidden section</p>
      <h1 className="mt-2 font-display text-4xl text-bone">Interviewer</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        This page is not in the CRM navigation. It is limited to an owner with interviewer access.
        The rate already includes margin. A blank time cap means no limit.
      </p>
      <a className="mt-4 inline-block text-sm text-amber underline" href="/crm">Back to CRM</a>
      {notice ? <p className="mt-4 rounded-2xl border border-edge bg-panel px-4 py-3 text-sm text-bone">{notice}</p> : null}

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <form className="rounded-3xl border border-edge bg-panel/90 p-5" onSubmit={(event) => { event.preventDefault(); void createCampaign(); }}>
          <h2 className="font-display text-2xl">New campaign</h2>
          <label className="mt-4 block text-sm">Name
            <input className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label className="mt-3 block text-sm">Voice
            <select className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>
              {INTERVIEWER_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.name} · {voice.gender} · {voice.accent}</option>
              ))}
            </select>
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-sm">Max minutes
              <input className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={maxMinutes} onChange={(event) => setMaxMinutes(event.target.value)} placeholder="No cap" />
            </label>
            <label className="text-sm">Rate / minute
              <input className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={rate} onChange={(event) => setRate(event.target.value)} />
            </label>
            <label className="text-sm">Currency
              <select className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={currency} onChange={(event) => setCurrency(event.target.value)}>
                <option>GBP</option>
                <option>USD</option>
                <option>EUR</option>
              </select>
            </label>
            <label className="text-sm">Margin % included
              <input className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={margin} onChange={(event) => setMargin(event.target.value)} />
            </label>
          </div>
          <label className="mt-3 block text-sm">Billing granularity
            <select className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={granularity} onChange={(event) => setGranularity(event.target.value)}>
              <option value="second">Per second</option>
              <option value="minute">Per started minute</option>
            </select>
          </label>
          <button className="mt-4 rounded-full bg-amber px-4 py-2 text-sm text-ink" type="submit">Save campaign</button>
        </form>

        <div className="rounded-3xl border border-edge bg-panel/90 p-5">
          <h2 className="font-display text-2xl">Test invite</h2>
          <label className="mt-4 block text-sm">Campaign
            <select className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm">Prospect name
            <input className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={prospectName} onChange={(event) => setProspectName(event.target.value)} />
          </label>
          <label className="mt-3 block text-sm">Prospect email, optional
            <input className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={prospectEmail} onChange={(event) => setProspectEmail(event.target.value)} />
          </label>
          <button className="mt-4 rounded-full bg-amber px-4 py-2 text-sm text-ink" type="button" onClick={() => void createInvite()}>Create test link</button>
          {invitePath ? <p className="mt-3 break-all text-sm text-bone">{invitePath}</p> : null}
          <h3 className="mt-6 font-display text-xl">Knowledge note</h3>
          <input className="mt-2 w-full rounded-xl border border-edge bg-ink px-3 py-2 text-sm" placeholder="Title" value={docTitle} onChange={(event) => setDocTitle(event.target.value)} />
          <textarea className="mt-2 h-28 w-full rounded-xl border border-edge bg-ink px-3 py-2 text-sm" placeholder="Facts the interviewer may use" value={docBody} onChange={(event) => setDocBody(event.target.value)} />
          <button className="mt-3 rounded-full bg-panel2 px-4 py-2 text-sm text-bone" type="button" onClick={() => void saveDocument()}>Save note</button>
        </div>
      </section>

      <section className="mt-8 rounded-3xl border border-edge bg-panel/90 p-5">
        <h2 className="font-display text-2xl">Campaigns</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {campaigns.map((campaign) => (
            <li key={campaign.id} className="rounded-2xl border border-edge px-3 py-2">
              <button type="button" className="text-bone" onClick={() => setCampaignId(campaign.id)}>{campaign.name}</button>
              <span className="ml-2 text-muted">{campaign.voice_id} · {campaign.currency} {campaign.rate_per_minute}/min · margin {campaign.margin_percent}% included · {campaign.billing_granularity}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 rounded-3xl border border-edge bg-panel/90 p-5">
        <h2 className="font-display text-2xl">Conversations</h2>
        <ul className="mt-3 divide-y divide-edge text-sm">
          {sessions.map((session) => (
            <li key={session.id} className="py-3">
              <button type="button" className="text-amber underline" onClick={() => void openSession(session.id)}>
                {new Date(session.created_at).toLocaleString("en-GB")} · {session.status}
              </button>
              <span className="ml-2 text-muted">
                {session.billable_seconds ?? 0}s · {session.disposition || "No disposition"}
                {session.calendar_event_id ? " · meeting booked" : ""}
              </span>
            </li>
          ))}
        </ul>
        {selected ? (
          <div className="mt-5">
            <p className="text-sm text-muted">
              {selected.session.timing_raw_quote ? `Timing: ${selected.session.timing_raw_quote}` : "No timing captured."}
              {selected.session.reason_code ? ` Reason: ${selected.session.reason_code}.` : ""}
            </p>
            {recordingUrl ? <audio className="mt-3 w-full" controls src={recordingUrl} /> : <p className="mt-3 text-sm text-muted">No recording saved yet.</p>}
            <ul className="mt-4 space-y-2">
              {selected.utterances.map((line) => (
                <li key={line.id} className="text-sm text-bone">
                  <span className="mr-2 font-mono text-[0.65rem] uppercase text-amber">{line.speaker}</span>
                  {line.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </main>
  );
}
