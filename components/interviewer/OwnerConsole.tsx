"use client";

import { useCallback, useEffect, useState } from "react";

import { CrmRequestError, crmFetch } from "@/lib/crm";
import {
  preferredCampaignId,
  validateBillingFields,
  validateCampaignFields,
  validateInviteFields,
  validateKnowledgeNote,
  type FieldErrors,
} from "@/lib/interviewer/form-fields";
import { presentTranscript } from "@/lib/interviewer/transcript-display";
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
};

type SessionRow = {
  id: string;
  status: string;
  billable_seconds: number | null;
  disposition: string | null;
  reason_code: string | null;
  timing_raw_quote: string | null;
  calendar_event_id: string | null;
  hasRecording: boolean;
  created_at: string;
};

type Utterance = { id: string; speaker: "agent" | "lead"; text: string; ts: string };
type Draft = { title: string; body: string };

function FieldNote({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-sm text-rust">{message}</p>;
}

async function postForm(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data: data as { fields?: FieldErrors; error?: string; campaign?: { id: string }; path?: string; documents?: Draft[]; saved?: number } };
}

export default function OwnerConsole() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState<{ session: SessionRow; utterances: Utterance[] } | null>(null);
  const [recordingUrl, setRecordingUrl] = useState("");
  const [invitePath, setInvitePath] = useState("");
  const [notice, setNotice] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [name, setName] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [maxMinutes, setMaxMinutes] = useState("");
  const [rate, setRate] = useState("0");
  const [currency, setCurrency] = useState("GBP");
  const [margin, setMargin] = useState("0");
  const [granularity, setGranularity] = useState("second");
  const [prospectName, setProspectName] = useState("");
  const [prospectEmail, setProspectEmail] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docBody, setDocBody] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [importing, setImporting] = useState(false);
  const [playing, setPlaying] = useState("");
  const [campaignErrors, setCampaignErrors] = useState<FieldErrors>({});
  const [inviteErrors, setInviteErrors] = useState<FieldErrors>({});
  const [noteErrors, setNoteErrors] = useState<FieldErrors>({});
  const [billingErrors, setBillingErrors] = useState<FieldErrors>({});
  const [siteErrors, setSiteErrors] = useState<FieldErrors>({});
  const [costs, setCosts] = useState<{ ready: boolean; label?: string; totals?: { calls: number; minutes: number; cost: string; revenue: string; margin: string; marginPercent: string }; calls?: Array<{ sessionId: string; seconds: number; cost: string; revenue: string; margin: string; marginPercent: string }> } | null>(null);
  const [deckNote, setDeckNote] = useState("");

  const explain = (error: unknown) => {
    if (error instanceof CrmRequestError) setNotice(error.message);
    else setNotice("The interviewer page could not be loaded. Reload it and check whether the list is still there.");
  };

  const load = useCallback(async () => {
    const data = await crmFetch<{ campaigns: Campaign[] }>("/api/crm/interviewer/campaigns");
    const list = data.campaigns || [];
    setCampaigns(list);
    const current = preferredCampaignId(list, campaignId);
    if (current !== campaignId) setCampaignId(current);
    if (current) {
      const rows = await crmFetch<{ sessions: SessionRow[] }>(`/api/crm/interviewer/sessions?campaignId=${current}`);
      setSessions(rows.sessions || []);
    }
  }, [campaignId]);

  useEffect(() => {
    load().catch(explain);
  }, [load]);

  useEffect(() => {
    const campaign = campaigns.find((item) => item.id === campaignId);
    if (!campaign) return;
    setRate(String(campaign.rate_per_minute ?? 0));
    setCurrency(campaign.currency || "GBP");
    setMargin(String(campaign.margin_percent ?? 0));
    setGranularity(campaign.billing_granularity || "second");
    fetch(`/api/crm/interviewer/costs?campaignId=${campaign.id}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setCosts(data))
      .catch(() => setCosts(null));
  }, [campaignId, campaigns]);

  const playVoice = async (id: string) => {
    setPlaying(id);
    try {
      const sampleName = name.trim() || campaigns.find((item) => item.id === campaignId)?.name || "the team";
      const response = await fetch(`/api/crm/interviewer/voice-preview?voiceId=${encodeURIComponent(id)}&name=${encodeURIComponent(sampleName)}&campaignId=${encodeURIComponent(campaignId)}`);
      if (!response.ok) {
        setCampaignErrors({ voiceId: "That sample could not be played." });
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      await audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    } finally {
      setPlaying("");
    }
  };

  const createCampaign = async () => {
    const checked = validateCampaignFields({ name, voiceId, maxMinutes });
    setCampaignErrors(checked.fields);
    if (Object.keys(checked.fields).length) return;
    setNotice("");
    const result = await postForm("/api/crm/interviewer/campaigns", {
      name,
      voiceId,
      maxMinutes: maxMinutes.trim() === "" ? null : Number(maxMinutes),
    });
    if (!result.ok) {
      setCampaignErrors(result.data.fields || { name: result.data.error || "The campaign was not saved." });
      return;
    }
    setCampaignId(result.data.campaign?.id || campaignId);
    setName("");
    setVoiceId("");
    setNotice("Campaign saved.");
    await load();
  };

  const saveBilling = async () => {
    const checked = validateBillingFields({ ratePerMinute: rate, currency, marginPercent: margin, billingGranularity: granularity });
    if (!campaignId) checked.fields.campaignId = "Pick a campaign.";
    setBillingErrors(checked.fields);
    if (Object.keys(checked.fields).length) return;
    const result = await postForm("/api/crm/interviewer/campaigns", {
      billingOnly: true,
      id: campaignId,
      ratePerMinute: rate,
      currency,
      marginPercent: margin,
      billingGranularity: granularity,
    });
    if (!result.ok) {
      setBillingErrors(result.data.fields || { ratePerMinute: result.data.error || "Billing was not saved." });
      return;
    }
    setNotice("Internal billing saved. Callers do not see it.");
    await load();
  };

  const createInvite = async () => {
    const fields = validateInviteFields({ campaignId, prospectName, prospectEmail });
    setInviteErrors(fields);
    if (Object.keys(fields).length) return;
    setInvitePath("");
    const result = await postForm("/api/crm/interviewer/invites", {
      campaignId, prospectName, prospectEmail, expiresInHours: 24 * 7,
    });
    if (!result.ok || !result.data.path) {
      setInviteErrors(result.data.fields || { campaignId: result.data.error || "The test link was not created." });
      return;
    }
    setInvitePath(`${window.location.origin}${result.data.path}`);
    setNotice("Test link created. It expires in 7 days. It has not been emailed.");
  };

  const saveDocument = async () => {
    const checked = validateKnowledgeNote({ campaignId, title: docTitle, body: docBody });
    setNoteErrors(checked.fields);
    if (Object.keys(checked.fields).length) return;
    const result = await postForm("/api/crm/interviewer/documents", {
      campaignId, title: checked.title, body: checked.body,
    });
    if (!result.ok) {
      setNoteErrors(result.data.fields || { body: result.data.error || "The note was not saved." });
      return;
    }
    setDocTitle("");
    setDocBody("");
    setNotice(docTitle.trim() ? "Knowledge note saved." : `Knowledge note saved as “${checked.title}”.`);
  };

  const importWebsite = async () => {
    setSiteErrors({});
    setImporting(true);
    const result = await postForm("/api/crm/interviewer/import-website", { url: websiteUrl });
    setImporting(false);
    if (!result.ok) {
      setSiteErrors(result.data.fields || { url: result.data.error || "The website could not be read." });
      return;
    }
    setDrafts(result.data.documents || []);
  };

  const saveDrafts = async () => {
    const result = await postForm("/api/crm/interviewer/import-website", {
      action: "save",
      campaignId,
      documents: drafts,
    });
    if (!result.ok) {
      setSiteErrors(result.data.fields || { campaignId: result.data.error || "The notes were not saved." });
      return;
    }
    setDrafts([]);
    setNotice("Website notes saved into the campaign brain.");
  };

  const uploadDeck = async (file: File) => {
    setDeckNote("");
    const form = new FormData();
    form.set("campaignId", campaignId);
    form.set("file", file);
    const response = await fetch("/api/crm/interviewer/deck", { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setDeckNote(data.fields?.file || data.fields?.campaignId || data.error || "The deck was not saved.");
      return;
    }
    const warning = Array.isArray(data.warnings) && data.warnings.length
      ? ` Warning: the deck mentions ${data.warnings.join(", ")}. Those lines were kept off the agent notes.`
      : "";
    setDeckNote(`Saved ${data.slides} slides.${warning}`);
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

  const shown = selected ? presentTranscript(selected.utterances.map((line) => ({
    id: line.id, speaker: line.speaker, text: line.text,
  }))) : [];

  return (
    <main className="relative z-10 mx-auto max-w-5xl px-5 py-10">
      <p className="font-mono text-[0.68rem] uppercase tracking-[0.22em] text-amber">Hidden section</p>
      <h1 className="mt-2 font-display text-4xl text-bone">Interviewer</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        This page is not in the CRM navigation. Choose a voice after you have heard it. The campaign notes are what the agent is allowed to talk about.
      </p>
      <a className="mt-4 inline-block text-sm text-amber underline" href="/crm">Back to CRM</a>
      {notice ? <p className="mt-4 text-sm text-bone">{notice}</p> : null}

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <form className="rounded-3xl border border-edge bg-panel/90 p-5" onSubmit={(event) => { event.preventDefault(); void createCampaign(); }}>
          <h2 className="font-display text-2xl">New campaign</h2>
          <label className="mt-4 block text-sm">Name
            <input className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <FieldNote message={campaignErrors.name} />
          <label className="mt-3 block text-sm">Max minutes, optional
            <input className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={maxMinutes} onChange={(event) => setMaxMinutes(event.target.value)} placeholder="No cap" />
          </label>
          <FieldNote message={campaignErrors.maxMinutes} />
          <fieldset className="mt-4">
            <legend className="text-sm">Voice</legend>
            <p className="mt-1 text-xs text-muted">British voices listed by Deepgram. Nothing is selected until you choose.</p>
            <div className="mt-2 space-y-2">
              {INTERVIEWER_VOICES.map((voice) => (
                <div key={voice.id} className="flex items-center justify-between gap-2 rounded-xl border border-edge px-3 py-2">
                  <label className="flex items-start gap-2 text-sm">
                    <input type="radio" name="voice" checked={voiceId === voice.id} onChange={() => setVoiceId(voice.id)} />
                    <span>{voice.name} · {voice.generation} · {voice.gender} · {voice.accent}</span>
                  </label>
                  <button type="button" className="text-sm text-amber underline" disabled={playing === voice.id} onClick={() => void playVoice(voice.id)}>
                    {playing === voice.id ? "Playing" : "Play"}
                  </button>
                </div>
              ))}
            </div>
            <FieldNote message={campaignErrors.voiceId} />
          </fieldset>
          <button className="mt-4 rounded-full bg-amber px-4 py-2 text-sm text-ink" type="submit">Save campaign</button>
        </form>

        <div className="rounded-3xl border border-edge bg-panel/90 p-5">
          <h2 className="font-display text-2xl">Test invite</h2>
          <label className="mt-4 block text-sm">Campaign
            <select className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
              <option value="">Choose a campaign</option>
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
            </select>
          </label>
          <FieldNote message={inviteErrors.campaignId} />
          <label className="mt-3 block text-sm">Prospect name
            <input className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={prospectName} onChange={(event) => setProspectName(event.target.value)} />
          </label>
          <FieldNote message={inviteErrors.prospectName} />
          <label className="mt-3 block text-sm">Prospect email, optional
            <input className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={prospectEmail} onChange={(event) => setProspectEmail(event.target.value)} />
          </label>
          <FieldNote message={inviteErrors.prospectEmail} />
          <button className="mt-4 rounded-full bg-amber px-4 py-2 text-sm text-ink" type="button" onClick={() => void createInvite()}>Create test link</button>
          {invitePath ? <p className="mt-3 break-all text-sm text-bone">{invitePath}</p> : null}

          <h3 className="mt-6 font-display text-xl">Knowledge note</h3>
          <p className="mt-1 text-xs text-muted">Title is optional. A blank title uses the start of the note.</p>
          <input className="mt-2 w-full rounded-xl border border-edge bg-ink px-3 py-2 text-sm" placeholder="Title, optional" value={docTitle} onChange={(event) => setDocTitle(event.target.value)} />
          <FieldNote message={noteErrors.title} />
          <textarea className="mt-2 h-28 w-full rounded-xl border border-edge bg-ink px-3 py-2 text-sm" placeholder="Facts the interviewer may use" value={docBody} onChange={(event) => setDocBody(event.target.value)} />
          <FieldNote message={noteErrors.body || noteErrors.campaignId} />
          <button className="mt-3 rounded-full bg-panel2 px-4 py-2 text-sm text-bone" type="button" onClick={() => void saveDocument()}>Save note</button>

          <h3 className="mt-6 font-display text-xl">Client website</h3>
          <input className="mt-2 w-full rounded-xl border border-edge bg-ink px-3 py-2 text-sm" placeholder="https://example.com" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} />
          <FieldNote message={siteErrors.url} />
          <button className="mt-3 rounded-full bg-panel2 px-4 py-2 text-sm text-bone" type="button" disabled={importing} onClick={() => void importWebsite()}>
            {importing ? "Reading the website" : "Import from website"}
          </button>
          {drafts.map((draft, index) => (
            <label key={`${draft.title}-${index}`} className="mt-3 block text-sm">{draft.title}
              <textarea className="mt-1 h-24 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={draft.body} onChange={(event) => {
                const next = drafts.slice();
                next[index] = { ...draft, body: event.target.value };
                setDrafts(next);
              }} />
            </label>
          ))}
          {drafts.length ? <button className="mt-3 rounded-full bg-amber px-4 py-2 text-sm text-ink" type="button" onClick={() => void saveDrafts()}>Save website notes</button> : null}
          <FieldNote message={siteErrors.campaignId || siteErrors.body} />
        </div>
      </section>

      <section className="mt-8 rounded-3xl border border-edge bg-panel/90 p-5">
        <h2 className="font-display text-2xl">Campaigns</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {campaigns.map((campaign) => (
            <li key={campaign.id} className="rounded-2xl border border-edge px-3 py-2">
              <button type="button" className="text-bone" onClick={() => setCampaignId(campaign.id)}>{campaign.name}</button>
              <span className="ml-2 text-muted">{campaign.voice_id}</span>
            </li>
          ))}
        </ul>
      </section>

      <details className="mt-8 rounded-3xl border border-edge bg-panel/90 p-5">
        <summary className="cursor-pointer font-display text-2xl">Billing (internal)</summary>
        <p className="mt-3 text-sm text-muted">What we charge this client per connected minute (never shown to callers)</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Rate per minute
            <input className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={rate} onChange={(event) => setRate(event.target.value)} />
          </label>
          <FieldNote message={billingErrors.ratePerMinute} />
          <label className="text-sm">Currency
            <select className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={currency} onChange={(event) => setCurrency(event.target.value)}>
              <option>GBP</option><option>USD</option><option>EUR</option>
            </select>
          </label>
          <label className="text-sm">Margin % included
            <input className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={margin} onChange={(event) => setMargin(event.target.value)} />
          </label>
          <label className="text-sm">Billing granularity
            <select className="mt-1 w-full rounded-xl border border-edge bg-ink px-3 py-2" value={granularity} onChange={(event) => setGranularity(event.target.value)}>
              <option value="second">Per second</option>
              <option value="minute">Per started minute</option>
            </select>
          </label>
        </div>
        <FieldNote message={billingErrors.campaignId || billingErrors.currency || billingErrors.marginPercent || billingErrors.billingGranularity} />
        <button className="mt-4 rounded-full bg-panel2 px-4 py-2 text-sm text-bone" type="button" onClick={() => void saveBilling()}>Save billing</button>
      </details>

      <section className="mt-8 rounded-3xl border border-edge bg-panel/90 p-5">
        <h2 className="font-display text-2xl">Deck</h2>
        <p className="mt-2 text-sm text-muted">Upload a PDF. PowerPoint needs to be exported as PDF first. Each slide becomes a few spoken points, not a script to read out.</p>
        <input className="mt-3 block text-sm" type="file" accept="application/pdf,.pdf" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadDeck(file);
        }} />
        {deckNote ? <p className="mt-2 text-sm text-bone">{deckNote}</p> : null}
      </section>

      <section className="mt-8 rounded-3xl border border-edge bg-panel/90 p-5">
        <h2 className="font-display text-2xl">Internal: never share with clients</h2>
        {costs?.ready && costs.totals ? (
          <>
            <p className="mt-3 text-sm text-bone">{costs.totals.calls} calls · {costs.totals.minutes} minutes · cost {costs.totals.cost} · billed {costs.totals.revenue} · margin {costs.totals.margin} ({costs.totals.marginPercent})</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {(costs.calls || []).map((call) => (
                <li key={call.sessionId}>{call.seconds}s · voice {call.voiceAgent} · listen {call.listen} · storage {call.storage} · hosting {call.vercel} · our cost {call.cost} · billed {call.revenue} · margin {call.margin} ({call.marginPercent})</li>
              ))}
            </ul>
          </>
        ) : <p className="mt-3 text-sm text-muted">Cost figures appear after the cost migration is applied and a call ends.</p>}
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
              {shown.map((line) => (
                <li key={line.id} className="text-sm text-bone">
                  <span className="mr-2 font-mono text-[0.65rem] uppercase text-amber">{line.speaker === "agent" ? "Interviewer" : "You"}</span>
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
