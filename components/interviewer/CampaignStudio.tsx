"use client";

import { useEffect, useState } from "react";

import { putSlideImages, renderPdfPages } from "@/components/interviewer/pdf-pages";
import styles from "@/components/interviewer/interviewa.module.css";
import { KNOWLEDGE_SECTIONS, SOURCE_WEBSITE_TITLE, emptyKnowledge, knowledgeFromDocuments, type KnowledgeSectionKey } from "@/lib/interviewer/knowledge";
import { INTERVIEWER_VOICES, voiceLabel, type AuraVoice } from "@/lib/interviewer/voices";

type Campaign = {
  id: string;
  name: string;
  voice_id: string;
  max_minutes: number | null;
  website_url?: string | null;
  website_scraped_at?: string | null;
  quotes_allowed?: boolean;
  brochure_send?: boolean;
  opener?: string | null;
  rate_per_minute?: number;
  currency?: string;
  margin_percent?: number;
  billing_granularity?: string;
};

type Slide = { number: number; title: string; url: string };
type Deck = { id: string; title: string; slides: Slide[] };
type CallRow = { id: string; created_at: string; disposition: string | null; status: string; billable_seconds: number | null };
type CostCall = { sessionId: string; cost: string; estimated: boolean; seconds: number };

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

function Tag({ children }: { children: string }) {
  return <span className={styles.pill}>{children}</span>;
}

export default function CampaignStudio({ campaignId }: { campaignId: string }) {
  const creating = !campaignId;
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [name, setName] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [maxMinutes, setMaxMinutes] = useState("");
  const [voices, setVoices] = useState<AuraVoice[]>([...INTERVIEWER_VOICES]);
  const [shortlist, setShortlist] = useState<string[]>([]);
  const [shortNote, setShortNote] = useState("");
  const [playing, setPlaying] = useState("");
  const [sections, setSections] = useState(emptyKnowledge());
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [scrapedAt, setScrapedAt] = useState("");
  const [decks, setDecks] = useState<Deck[]>([]);
  const [quotes, setQuotes] = useState(false);
  const [brochure, setBrochure] = useState(false);
  const [opener, setOpener] = useState("");
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [costs, setCosts] = useState<{ label?: string; totals?: { cost: string; setup: string; callsCost: string; estimates?: boolean }; setup?: Array<{ kind: string; detail: string; amount: string }>; calls?: CostCall[] } | null>(null);
  const [invitePath, setInvitePath] = useState("");
  const [prospectName, setProspectName] = useState("");
  const [prospectEmail, setProspectEmail] = useState("");
  const [rate, setRate] = useState("0");
  const [currency, setCurrency] = useState("GBP");
  const [margin, setMargin] = useState("0");
  const [granularity, setGranularity] = useState("second");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const offered = shortlist.length
    ? voices.filter((voice) => shortlist.includes(voice.id) || voice.id === voiceId)
    : voices;

  useEffect(() => {
    fetch("/api/crm/interviewer/voices", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data.voices) && data.voices.length) setVoices(data.voices);
        setShortlist(data.shortlist || []);
        if (data.note) setShortNote(data.note);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!campaignId) return;
    fetch("/api/crm/interviewer/campaigns", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        const found = (data.campaigns || []).find((item: Campaign) => item.id === campaignId);
        if (!found) { setError("That campaign was not found."); return; }
        setCampaign(found);
        setName(found.name);
        setVoiceId(found.voice_id);
        setMaxMinutes(found.max_minutes == null ? "" : String(found.max_minutes));
        setWebsiteUrl(found.website_url || "");
        setScrapedAt(found.website_scraped_at || "");
        setQuotes(found.quotes_allowed === true);
        setBrochure(found.brochure_send === true);
        setOpener(found.opener || "");
        setRate(String(found.rate_per_minute ?? 0));
        setCurrency(found.currency || "GBP");
        setMargin(String(found.margin_percent ?? 0));
        setGranularity(found.billing_granularity || "second");
      })
      .catch(() => setError("The campaign could not be loaded."));
    fetch(`/api/crm/interviewer/documents?campaignId=${campaignId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        const docs = data.documents || [];
        setSections(knowledgeFromDocuments(docs));
        const source = docs.find((doc: { title: string; body: string }) => doc.title === SOURCE_WEBSITE_TITLE);
        if (source && !websiteUrl) setWebsiteUrl(String(source.body).split("\n")[0]);
      })
      .catch(() => undefined);
    fetch(`/api/crm/interviewer/deck?campaignId=${campaignId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setDecks(data.decks || []))
      .catch(() => setDecks([]));
    fetch(`/api/crm/interviewer/sessions?campaignId=${campaignId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setCalls(data.sessions || []))
      .catch(() => setCalls([]));
    fetch(`/api/crm/interviewer/costs?campaignId=${campaignId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setCosts(data))
      .catch(() => setCosts(null));
  }, [campaignId]);

  const play = async (id: string) => {
    setPlaying(id);
    try {
      const response = await fetch(`/api/crm/interviewer/voice-preview?voiceId=${encodeURIComponent(id)}&name=${encodeURIComponent(name || "the team")}&campaignId=${encodeURIComponent(campaignId)}`);
      if (!response.ok) { setError("That sample could not be played."); return; }
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      await audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    } finally {
      setPlaying("");
    }
  };

  const saveShortlist = async (next: string[]) => {
    setShortlist(next);
    const result = await postJson("/api/crm/interviewer/voices", { voiceIds: next });
    setShortNote(result.data.note || (result.data.saved ? "Shortlist saved." : ""));
  };

  const saveBasics = async () => {
    setError("");
    const result = await postJson("/api/crm/interviewer/campaigns", {
      id: campaignId || undefined,
      name,
      voiceId,
      maxMinutes: maxMinutes.trim() === "" ? null : Number(maxMinutes),
    });
    if (!result.ok) { setError(result.data.fields?.voiceId || result.data.fields?.name || result.data.error || "The campaign was not saved."); return; }
    setNotice("Campaign saved.");
    if (creating && result.data.campaign?.id) window.location.href = `/crm/interviewer/campaigns/${result.data.campaign.id}`;
  };

  const saveKnowledge = async (scraped = false) => {
    if (!campaignId) { setError("Save the campaign name and voice first."); return; }
    const result = await postJson("/api/crm/interviewer/documents", {
      campaignId,
      websiteUrl,
      scraped,
      sections: KNOWLEDGE_SECTIONS.map((section) => ({ title: section.title, body: sections[section.key] })),
    });
    if (!result.ok) { setError(result.data.fields?.campaignId || "The knowledge was not saved."); return; }
    setNotice(result.data.websiteStored === false ? "Notes saved. The website address is stored with the notes until the migration is applied." : "Knowledge saved.");
  };

  const importSite = async () => {
    if (!campaignId) { setError("Save the campaign name and voice first."); return; }
    setError("");
    const result = await postJson("/api/crm/interviewer/import-website", { url: websiteUrl, campaignId });
    if (!result.ok) { setError(result.data.fields?.url || "The website could not be read."); return; }
    const next = emptyKnowledge();
    for (const draft of result.data.documents || []) {
      const section = KNOWLEDGE_SECTIONS.find((item) => item.title.toLowerCase() === String(draft.title).toLowerCase());
      if (section) next[section.key] = draft.body;
    }
    setSections(next);
    setScrapedAt(new Date().toISOString());
    await saveKnowledge(true);
  };

  const reloadDecks = async () => {
    const slidesResponse = await fetch(`/api/crm/interviewer/deck?campaignId=${campaignId}`, { cache: "no-store" });
    const slidesData = await slidesResponse.json().catch(() => ({}));
    setDecks(slidesData.decks || []);
  };

  const uploadDeck = async (file: File, deckId?: string) => {
    if (!campaignId) { setError("Save the campaign before uploading a deck."); return; }
    setError("");
    setNotice(deckId ? "Replacing slide images…" : "Reading the PDF in the browser…");
    try {
      const pages = await renderPdfPages(file);
      const prepared = await postJson("/api/crm/interviewer/deck", deckId
        ? { action: "replace", deckId, pageCount: pages.length }
        : { action: "prepare", campaignId, fileName: file.name, pageCount: pages.length });
      if (!prepared.ok) {
        setError(prepared.data.fields?.file || prepared.data.fields?.campaignId || "The deck was not saved.");
        return;
      }
      await putSlideImages(prepared.data.uploads || [], pages);
      const notes = await postJson("/api/crm/interviewer/deck", { action: "notes", deckId: prepared.data.deckId });
      await reloadDecks();
      const missing = Array.isArray(notes.data.missing) && notes.data.missing.length ? ` ${notes.data.missing.length} images were not readable.` : "";
      setNotice(notes.ok ? `Saved ${pages.length} page images.${missing}` : "Images uploaded. The slide notes were not rewritten.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The deck was not saved.");
    }
  };

  const saveBehaviour = async () => {
    const result = await postJson("/api/crm/interviewer/campaigns", {
      behaviourOnly: true,
      id: campaignId,
      quotesAllowed: quotes,
      brochureSend: brochure,
      opener,
    });
    setNotice(result.data.note || "Agent settings saved.");
  };

  const createInvite = async () => {
    const result = await postJson("/api/crm/interviewer/invites", { campaignId, prospectName, prospectEmail, expiresInHours: 24 * 7 });
    if (!result.ok || !result.data.path) { setError(result.data.fields?.prospectName || "The test link was not created."); return; }
    setInvitePath(`${window.location.origin}${result.data.path}`);
  };

  const saveBilling = async () => {
    const result = await postJson("/api/crm/interviewer/campaigns", {
      billingOnly: true, id: campaignId, ratePerMinute: rate, currency, marginPercent: margin, billingGranularity: granularity,
    });
    setNotice(result.ok ? "Internal billing saved." : "Billing was not saved.");
  };

  const costFor = (id: string) => costs?.calls?.find((call) => call.sessionId === id);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.headRow}>
          <h1 className={styles.h1}>{name || "New campaign"}</h1>
          <span className={creating ? styles.warn : styles.ok}>{creating ? "New" : "Active"}</span>
        </div>
        <p className={styles.lede}>{voiceId ? voiceLabel(voiceId) : "Choose a voice after you have heard it."}</p>
      </section>
      <p style={{ margin: "12px 0" }}><a className={styles.link} href="/crm/interviewer">All campaigns</a></p>
      {notice ? <p className={styles.note}>{notice}</p> : null}
      {error ? <p className={styles.err}>{error}</p> : null}

      <div className={styles.stack}>
        <section className={styles.card}>
          <div className={styles.sectionHead}><span className={styles.tile}>1</span> Basics</div>
          <label className={styles.label}>Name<input className={styles.field} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className={styles.label}>Max length, optional<input className={styles.field} value={maxMinutes} placeholder="No cap" onChange={(event) => setMaxMinutes(event.target.value)} /></label>
          <p className={styles.label}>Voice shortlist</p>
          <p className={styles.note}>Tick the voices this account may use. The campaign picker below uses that shortlist. Tags are Deepgram’s own.</p>
          {shortNote ? <p className={styles.note}>{shortNote}</p> : null}
          <div className={styles.voiceList}>
            {voices.map((voice) => (
              <div key={voice.id} className={styles.voice}>
                <label>
                  <input type="checkbox" checked={shortlist.includes(voice.id)} onChange={() => {
                    const next = shortlist.includes(voice.id) ? shortlist.filter((id) => id !== voice.id) : [...shortlist, voice.id];
                    void saveShortlist(next);
                  }} />
                  {" "}<b>{voice.name}</b> · {voice.generation}
                  <span className={styles.tags}>
                    <Tag>{voice.gender}</Tag><Tag>{voice.accent}</Tag><Tag>{voice.characteristics}</Tag>
                  </span>
                </label>
                <button type="button" className={styles.btnGhost} disabled={playing === voice.id} onClick={() => void play(voice.id)}>{playing === voice.id ? "Playing" : "Play"}</button>
              </div>
            ))}
          </div>
          <p className={styles.label}>Voice for this campaign</p>
          <div className={styles.stack}>
            {offered.map((voice) => (
              <label key={voice.id} className={styles.switch}>
                <input type="radio" name="campaign-voice" checked={voiceId === voice.id} onChange={() => setVoiceId(voice.id)} />
                <span style={{ textTransform: "capitalize" }}>{voice.name}</span>
                <span className={styles.note}>{voice.accent} · {voice.gender}</span>
                <button type="button" className={styles.btnGhost} onClick={() => void play(voice.id)}>Play</button>
              </label>
            ))}
          </div>
          <button type="button" className={styles.btn} style={{ marginTop: 12 }} onClick={() => void saveBasics()}>Save basics</button>
        </section>

        <section className={styles.card}>
          <div className={styles.sectionHead}><span className={styles.tile}>2</span> Knowledge</div>
          <label className={styles.label}>Website
            <input className={styles.field} value={websiteUrl} placeholder="https://" onChange={(event) => setWebsiteUrl(event.target.value)} />
          </label>
          <p className={styles.note}>{websiteUrl ? `Source: ${websiteUrl}` : "No source website yet."} {scrapedAt ? `Last scraped ${new Date(scrapedAt).toLocaleString("en-GB")}.` : ""}</p>
          <button type="button" className={styles.btnGhost} onClick={() => void importSite()}>Import from website</button>
          {KNOWLEDGE_SECTIONS.map((section) => (
            <label key={section.key} className={styles.label}>{section.title}
              <textarea className={styles.area} value={sections[section.key as KnowledgeSectionKey]} onChange={(event) => setSections({ ...sections, [section.key]: event.target.value })} />
            </label>
          ))}
          <button type="button" className={styles.btn} onClick={() => void saveKnowledge(false)}>Save knowledge</button>
          <p className={styles.label}>Deck</p>
          <p className={styles.note}>Pages are turned into images in this browser, then uploaded straight to storage. PDFs up to 50 MB.</p>
          <input type="file" accept="application/pdf,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadDeck(file); }} />
          {decks.map((deck) => (
            <div key={deck.id} style={{ marginTop: 12 }}>
              <div className={styles.headRow}>
                <strong>{deck.title}</strong>
                <label className={styles.btnGhost}>
                  Replace images
                  <input type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadDeck(file, deck.id); }} />
                </label>
              </div>
              <div className={styles.thumbs}>
                {deck.slides.map((slide) => (
                  <figure key={`${deck.id}-${slide.number}`} style={{ margin: 0 }}>
                    {slide.url ? <img src={slide.url} alt={slide.title || `Slide ${slide.number}`} /> : <div className={styles.thumb} />}
                    <figcaption className={styles.note}>{slide.number}. {slide.title}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className={styles.card}>
          <div className={styles.sectionHead}><span className={styles.tile}>3</span> Agent behaviour</div>
          <label className={styles.switch}><input type="checkbox" checked={quotes} onChange={(event) => setQuotes(event.target.checked)} /> Phone quotes allowed</label>
          <label className={styles.switch}><input type="checkbox" checked={brochure} onChange={(event) => setBrochure(event.target.checked)} /> Brochure send allowed</label>
          <label className={styles.label}>Opener
            <input className={styles.field} value={opener} placeholder="What got you interested in this business?" onChange={(event) => setOpener(event.target.value)} />
          </label>
          <button type="button" className={styles.btn} disabled={creating} onClick={() => void saveBehaviour()}>Save behaviour</button>
        </section>

        <section className={styles.card}>
          <div className={styles.sectionHead}><span className={styles.tile}>4</span> Test links</div>
          <label className={styles.label}>Lead name<input className={styles.field} value={prospectName} onChange={(event) => setProspectName(event.target.value)} /></label>
          <label className={styles.label}>Email, optional<input className={styles.field} value={prospectEmail} onChange={(event) => setProspectEmail(event.target.value)} /></label>
          <button type="button" className={styles.btn} disabled={creating} onClick={() => void createInvite()}>Create test link</button>
          {invitePath ? <p className={styles.note}>{invitePath}</p> : null}
        </section>

        <section className={styles.card}>
          <div className={styles.sectionHead}><span className={styles.tile}>5</span> Calls</div>
          <ul className={styles.stack} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {calls.map((call) => {
              const cost = costFor(call.id);
              const tone = call.disposition === "Hot" ? styles.org : call.disposition === "Warm" ? styles.warn : styles.pill;
              return (
                <li key={call.id} className={styles.headRow}>
                  <a className={styles.link} href={`/crm/interviewer/calls/${call.id}`}>{new Date(call.created_at).toLocaleString("en-GB")}</a>
                  <span className={tone}>{call.disposition || "No outcome"}</span>
                  <span className={styles.note}>{cost ? `${cost.cost}${cost.estimated ? " estimate" : ""}` : `${call.billable_seconds ?? 0}s`}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <details className={styles.card}>
          <summary className={styles.sectionHead}><span className={styles.tile}>6</span> Billing and true cost (internal)</summary>
          <p className={styles.note}>{costs?.label || "Internal: never share with clients"}</p>
          <div className={styles.grid2}>
            <label className={styles.label}>Rate per minute<input className={styles.field} value={rate} onChange={(event) => setRate(event.target.value)} /></label>
            <label className={styles.label}>Currency
              <select className={styles.select} value={currency} onChange={(event) => setCurrency(event.target.value)}><option>GBP</option><option>USD</option><option>EUR</option></select>
            </label>
            <label className={styles.label}>Margin %<input className={styles.field} value={margin} onChange={(event) => setMargin(event.target.value)} /></label>
            <label className={styles.label}>Granularity
              <select className={styles.select} value={granularity} onChange={(event) => setGranularity(event.target.value)}><option value="second">Per second</option><option value="minute">Per minute</option></select>
            </label>
          </div>
          <button type="button" className={styles.btnGhost} disabled={creating} onClick={() => void saveBilling()}>Save billing</button>
          {costs?.totals ? <p>Setup {costs.totals.setup} · calls {costs.totals.callsCost} · total {costs.totals.cost}{costs.totals.estimates ? " (includes estimates from duration)" : ""}</p> : null}
          <ul>{(costs?.setup || []).map((item) => <li key={item.kind}>{item.kind}: {item.amount} · {item.detail}</li>)}</ul>
        </details>
      </div>
      {campaign ? null : null}
    </main>
  );
}
