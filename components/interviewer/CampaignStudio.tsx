"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { putSlideImages, renderPdfPages } from "@/components/interviewer/pdf-pages";
import { customerHeadline } from "@/lib/interviewer/slide-headline";
import styles from "@/components/interviewer/interviewa.module.css";
import { findFactClashes, mergeKnowledge, type FactClash, type ResolvedClash } from "@/lib/interviewer/fact-clash";
import { KNOWLEDGE_CHAR_CAP, KNOWLEDGE_SECTIONS, SOURCE_WEBSITE_TITLE, emptyKnowledge, knowledgeFromDocuments, knowledgeLength, type KnowledgeSectionKey } from "@/lib/interviewer/knowledge";
import { DEFAULT_QUALIFYING_QUESTIONS, QUALIFYING_TITLE } from "@/lib/interviewer/qualifying";
import {
  STARTER_OBJECTIONS,
  formatObjections,
  formatPrice,
  formatProduct,
  formatQuestions,
  parseObjections,
  parsePrice,
  parseProduct,
  priceSpeech,
  questionLines,
  type ObjectionPair,
  type PricePlan,
} from "@/lib/interviewer/setup-fields";
import { extractSetup, mergeExtracts, planPreview, suggestionsFor, type ExtractSource, type Suggestion } from "@/lib/interviewer/setup-extract";
import { renderSVG } from "@/lib/interviewer/uqr.mjs";
import { PUBLIC_CALLS_TITLE, publicCallsOpen, publicCampaignPath } from "@/lib/interviewer/public-campaign";
import { appendShareQuery } from "@/lib/interviewer/share-link";
import { defaultOpener } from "@/lib/interviewer/salesTemplate";
import { formatCallLength } from "@/lib/interviewer/recording-clock";
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

type Slide = { number: number; title: string; url: string; missing?: boolean; oneLine?: string; talkingPoints?: string };
type FetchedPage = { url: string; chars: number };
type SourceDoc = { title: string; body: string; source: ExtractSource };
type TestLink = { path: string; name: string; expiresAt: string };
type Deck = { id: string; title: string; active?: boolean; imagesMissing?: boolean; slides: Slide[] };
type DeckJob = { phase: "rendering" | "uploading" | "notes" | "saved" | "error"; fileName: string; page: number; total: number; message: string };
type CallRow = { id: string; created_at: string; disposition: string | null; status: string; billable_seconds: number | null };
type CostCall = { sessionId: string; cost: string; estimated: boolean; seconds: number };
type OpenClash = FactClash & { choice: ResolvedClash["choice"] | ""; custom: string };

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

function Tag({ children }: { children: string }) {
  return <span className={styles.pill}>{children}</span>;
}

function absoluteLink(path: string, shareQuery = ""): string {
  const absolute = typeof window === "undefined"
    ? path
    : path.startsWith("http") ? path : `${window.location.origin}${path}`;
  return appendShareQuery(absolute, shareQuery);
}

function expiryLabel(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  const past = when.getTime() < Date.now();
  const stamp = when.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${past ? "Expired" : "Expires"} ${stamp}`;
}

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch { /* use the selection fallback */ }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "true");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  document.execCommand("copy");
  area.remove();
}

function TestLinkBlock({
  link,
  featured,
  copied,
  shareQuery,
  onCopy,
  onOpen,
}: {
  link: TestLink;
  featured?: boolean;
  copied: boolean;
  shareQuery: string;
  onCopy: () => void;
  onOpen: (url: string) => void;
}) {
  const [shortCopied, setShortCopied] = useState(false);
  const url = absoluteLink(link.path, shareQuery);
  const shortUrl = `${url}${url.includes("?") ? "&" : "?"}capMinutes=3`;
  const copyShort = () => {
    void navigator.clipboard?.writeText(shortUrl).then(() => {
      setShortCopied(true);
      window.setTimeout(() => setShortCopied(false), 1500);
    });
  };
  const field = (
    <button type="button" className={styles.linkField} onClick={() => onOpen(url)} onDoubleClick={() => onOpen(url)}>
      {url}
    </button>
  );
  const actions = (
    <div className={styles.linkActions}>
      <button type="button" className={styles.btn} onClick={() => void onCopy()}>{copied ? "Copied" : "Copy link"}</button>
      <button type="button" className={styles.btnGhost} onClick={() => onOpen(url)}>Open call</button>
    </div>
  );
  if (featured) {
    return (
      <article className={styles.ready}>
        <h3 className={styles.readyTitle}>Test link ready</h3>
        <p className={styles.note}>{link.name} · {expiryLabel(link.expiresAt)}</p>
        {field}
        {actions}
        <p className={styles.note}>A 3-minute test adds ?capMinutes=3. It only applies when the campaign name contains “test”. A live campaign keeps its saved limit.</p>
        {shareQuery ? <p className={styles.note}>This preview link includes Vercel’s access pass, so someone outside the team can open it. Production links do not add that pass.</p> : null}
        <button type="button" className={styles.btnGhost} onClick={copyShort}>{shortCopied ? "Copied" : "Copy 3-minute test"}</button>
      </article>
    );
  }
  return (
    <div className={styles.linkRow}>
      <div>
        <strong>{link.name}</strong>
        <p className={styles.note}>{expiryLabel(link.expiresAt)}</p>
        {field}
      </div>
      {actions}
    </div>
  );
}

function Step({
  n,
  title,
  hint,
  done,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <section className={styles.step} id={`setup-step-${n}`}>
      <header className={styles.stepHead}>
        <span className={styles.stepNum}>{n}</span>
        <div>
          <h2>{title}</h2>
          <p>{hint}</p>
        </div>
        <span className={done ? styles.ok : styles.warn}>{done ? "Done" : "Needs attention"}</span>
      </header>
      <div className={styles.stepBody}>{children}</div>
    </section>
  );
}

function Fold({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={styles.card}>
      <button type="button" className={styles.foldSummary} aria-expanded={open} onClick={onToggle}>
        <span className={styles.sectionHead}>{title}</span>
      </button>
      {open ? <div className={styles.foldBody}>{children}</div> : null}
    </section>
  );
}

function SuggestBox({
  step,
  items,
  onApply,
  onAll,
}: {
  step: number;
  items: Suggestion[];
  onApply: (item: Suggestion) => void;
  onAll: () => void;
}) {
  const mine = items.filter((item) => item.step === step);
  if (!mine.length) return null;
  return (
    <div className={styles.suggest}>
      <p className={styles.label}>Suggested from website or brochure</p>
      <p className={styles.note}>Filled fields stay as they are. Apply writes only the empty ones.</p>
      {mine.map((item) => (
        <div key={item.id} className={styles.suggestRow}>
          <div>
            <strong>{item.label}</strong>
            <span className={styles.note}> {item.source}</span>
            <p className={styles.note}>{item.preview}</p>
          </div>
          <button type="button" className={styles.btnGhost} onClick={() => onApply(item)}>Apply</button>
        </div>
      ))}
      <button type="button" className={styles.btn} onClick={onAll}>Apply all</button>
    </div>
  );
}

export default function CampaignStudio({ campaignId, shareQuery = "" }: { campaignId: string; shareQuery?: string }) {
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
  const [deckNote, setDeckNote] = useState("");
  const [fetchedPages, setFetchedPages] = useState<FetchedPage[]>([]);
  const [deckJob, setDeckJob] = useState<DeckJob | null>(null);
  const [importing, setImporting] = useState(false);
  const [quotes, setQuotes] = useState(false);
  const [brochure, setBrochure] = useState(false);
  const [opener, setOpener] = useState("");
  const [qualifying, setQualifying] = useState(DEFAULT_QUALIFYING_QUESTIONS.join("\n"));
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [costs, setCosts] = useState<{ label?: string; totals?: { cost: string; setup: string; callsCost: string; estimates?: boolean }; setup?: Array<{ kind: string; detail: string; amount: string }>; calls?: CostCall[] } | null>(null);
  const [links, setLinks] = useState<TestLink[]>([]);
  const [readyPath, setReadyPath] = useState("");
  const [copiedPath, setCopiedPath] = useState("");
  const copyTimer = useRef<number | null>(null);
  const openedAt = useRef(0);
  const [prospectName, setProspectName] = useState("");
  const [prospectEmail, setProspectEmail] = useState("");
  const [rate, setRate] = useState("0");
  const [currency, setCurrency] = useState("GBP");
  const [margin, setMargin] = useState("0");
  const [granularity, setGranularity] = useState("second");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ sources: true });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [step, setStep] = useState(1);
  const [bookingUrl, setBookingUrl] = useState("");
  const [bookingKnown, setBookingKnown] = useState(false);
  const [slidePick, setSlidePick] = useState(1);
  const [sourceDocs, setSourceDocs] = useState<SourceDoc[]>([]);
  const [freshExtract, setFreshExtract] = useState<Array<{ source: ExtractSource; text: string }>>([]);
  const [sellSaved, setSellSaved] = useState(false);
  const [acceptingCalls, setAcceptingCalls] = useState(true);
  const [shareCopied, setShareCopied] = useState(false);
  const [clashes, setClashes] = useState<OpenClash[]>([]);
  const [pendingBrochure, setPendingBrochure] = useState(emptyKnowledge());
  const [pendingWebsite, setPendingWebsite] = useState(emptyKnowledge());

  const offered = shortlist.length
    ? voices.filter((voice) => shortlist.includes(voice.id) || voice.id === voiceId)
    : voices;

  useEffect(() => {
    const key = `interviewa-sections-${campaignId || "new"}`;
    try {
      const saved = JSON.parse(window.localStorage.getItem(key) || "");
      if (saved && typeof saved === "object") setOpenSections({ sources: true, ...saved });
    } catch { /* a missing preference just uses the defaults */ }
  }, [campaignId]);

  const toggleSection = (id: string) => {
    setOpenSections((current) => {
      const next = { ...current, [id]: !current[id] };
      try { window.localStorage.setItem(`interviewa-sections-${campaignId || "new"}`, JSON.stringify(next)); } catch { /* the page still opens and closes */ }
      return next;
    });
  };

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
    let cancelled = false;
    (async () => {
      try {
        const [campaignResponse, documentResponse] = await Promise.all([
          fetch("/api/crm/interviewer/campaigns", { cache: "no-store" }),
          fetch(`/api/crm/interviewer/documents?campaignId=${campaignId}`, { cache: "no-store" }),
        ]);
        const campaignData = await campaignResponse.json();
        const documentData = await documentResponse.json();
        if (cancelled) return;
        setBookingUrl(String(campaignData.bookingUrl || ""));
        setBookingKnown(true);
        const found = (campaignData.campaigns || []).find((item: Campaign) => item.id === campaignId);
        if (!found) { setError("That campaign was not found."); return; }
        const docs = documentData.documents || [];
        setSourceDocs((docs as Array<{ title?: string; body?: string; source?: string | null }>).flatMap((doc) => {
          const source = doc.source === "website-import" ? "website" : doc.source === "deck-import" ? "brochure" : "";
          const body = String(doc.body || "");
          return source && body ? [{ title: String(doc.title || ""), body, source }] : [];
        }));
        const source = docs.find((doc: { title: string; body: string }) => doc.title === SOURCE_WEBSITE_TITLE);
        setCampaign(found);
        setName(found.name);
        setVoiceId(found.voice_id);
        setMaxMinutes(found.max_minutes == null ? "" : String(found.max_minutes));
        setWebsiteUrl((current) => found.website_url || (source ? String(source.body).split("\n")[0] : current));
        setScrapedAt(found.website_scraped_at || "");
        setQuotes(found.quotes_allowed === true);
        setBrochure(found.brochure_send === true);
        setOpener(found.opener || defaultOpener(found.name || ""));
        const qualifyingNote = docs.find((doc: { title: string; body: string }) => doc.title === QUALIFYING_TITLE);
        setQualifying(qualifyingNote?.body || DEFAULT_QUALIFYING_QUESTIONS.join("\n"));
        setAcceptingCalls(publicCallsOpen(docs.filter((doc: { title: string }) => doc.title === PUBLIC_CALLS_TITLE)));
        setRate(String(found.rate_per_minute ?? 0));
        setCurrency(found.currency || "GBP");
        setMargin(String(found.margin_percent ?? 0));
        setGranularity(found.billing_granularity || "second");
        setSections(knowledgeFromDocuments(docs));
      } catch {
        if (!cancelled) setError("The campaign could not be loaded.");
      }
    })();
    fetch(`/api/crm/interviewer/deck?campaignId=${campaignId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        if (data.websiteHint) setWebsiteUrl((current) => current || String(data.websiteHint));
        if (data.ready === false) {
          setDecks([]);
          setDeckNote(data.error || "The deck could not be loaded.");
          return;
        }
        setDecks(data.decks || []);
        setDeckNote((data.decks || []).length ? "" : "No deck is stored for this campaign.");
      })
      .catch(() => { if (!cancelled) setDeckNote("The deck could not be loaded."); });
    fetch(`/api/crm/interviewer/sessions?campaignId=${campaignId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (!cancelled) setCalls(data.sessions || []); })
      .catch(() => { if (!cancelled) setCalls([]); });
    fetch(`/api/crm/interviewer/invites?campaignId=${campaignId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (!cancelled) setLinks(data.invites || []); })
      .catch(() => { if (!cancelled) setLinks([]); });
    fetch(`/api/crm/interviewer/costs?campaignId=${campaignId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (!cancelled) setCosts(data); })
      .catch(() => { if (!cancelled) setCosts(null); });
    return () => { cancelled = true; };
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
    if (!result.ok) { setError(result.data.fields?.voiceId || result.data.fields?.name || result.data.error || "The campaign was not saved."); return false; }
    setNotice("Campaign saved.");
    if (creating && result.data.campaign?.id) window.location.href = `/crm/interviewer/campaigns/${result.data.campaign.id}`;
    return true;
  };

  const saveKnowledge = async (scraped = false, next = sections) => {
    if (!campaignId) { setError("Save the campaign name and voice first."); return false; }
    const result = await postJson("/api/crm/interviewer/documents", {
      campaignId,
      websiteUrl,
      scraped,
      sections: KNOWLEDGE_SECTIONS.map((section) => ({ title: section.title, body: next[section.key] })),
    });
    if (!result.ok) { setError(result.data.fields?.url || result.data.fields?.campaignId || "The knowledge was not saved."); return false; }
    setNotice(result.data.websiteStored === false ? "Notes saved. The website address is stored with the notes until the migration is applied." : "Knowledge saved.");
    return true;
  };

  const stageClash = async (
    brochureNotes: typeof sections,
    websiteNotes: typeof sections,
  ) => {
    const review = await postJson("/api/crm/interviewer/knowledge-conflicts", { brochure: brochureNotes, website: websiteNotes });
    const found = (Array.isArray(review.data.clashes) ? review.data.clashes : findFactClashes(brochureNotes, websiteNotes)) as FactClash[];
    if (!found.length) {
      setClashes([]);
      setNotice("No facts clashed. Apply the suggestions you want, then Save campaign. Filled fields were left as they are.");
      return;
    }
    setPendingBrochure(brochureNotes);
    setPendingWebsite(websiteNotes);
    setClashes(found.map((clash) => ({ ...clash, choice: "", custom: "" })));
    setNotice("Resolve every difference before the notes are saved.");
  };

  const chooseClash = (id: string, choice: OpenClash["choice"], custom?: string) => {
    setClashes((current) => current.map((clash) => clash.id === id ? { ...clash, choice, custom: custom ?? clash.custom } : clash));
  };

  const saveResolved = async () => {
    if (clashes.some((clash) => !clash.choice || (clash.choice === "custom" && !clash.custom.trim()))) {
      setError("Choose brochure, website, a custom value, or keep both unconfirmed for every item.");
      return;
    }
    const resolved = clashes.flatMap((clash) => clash.choice ? [{ ...clash, choice: clash.choice }] : []);
    const merged = mergeKnowledge(pendingBrochure, pendingWebsite, resolved);
    const saved = await saveKnowledge(Boolean(websiteUrl), merged);
    if (!saved) return;
    setSections(merged);
    setClashes([]);
    setNotice("Knowledge saved. Unconfirmed lines must not be quoted on a call.");
  };

  const importSite = async () => {
    if (!campaignId || importing) { if (!campaignId) setError("Save the campaign name and voice first."); return; }
    setImporting(true);
    setError("");
    try {
      const result = await postJson("/api/crm/interviewer/import-website", { url: websiteUrl, campaignId });
      const pages = Array.isArray(result.data.pages) ? result.data.pages as FetchedPage[] : [];
      setFetchedPages(pages);
      if (!result.ok) { setError(result.data.fields?.url || "The website could not be read."); return; }
      const documents = Array.isArray(result.data.documents) ? result.data.documents as Array<{ body?: string }> : [];
      const sourceText = String(result.data.sourceText || documents.map((document) => document.body || "").join("\n"));
      setFreshExtract((current) => [...current.filter((item) => item.source !== "website"), { source: "website", text: sourceText }]);
      setScrapedAt(new Date().toISOString());
      const next = knowledgeFromDocuments(result.data.documents || []);
      if (knowledgeLength(sections) > 0) await stageClash(sections, next);
      setNotice("Suggestions are ready. Apply the ones you want. Filled fields were left as they are.");
    } finally {
      setImporting(false);
    }
  };

  const reloadDecks = async () => {
    const slidesResponse = await fetch(`/api/crm/interviewer/deck?campaignId=${campaignId}`, { cache: "no-store" });
    const slidesData = await slidesResponse.json().catch(() => ({}));
    setDecks(slidesData.decks || []);
  };

  const uploadDeck = async (file: File, deckId?: string) => {
    if (!campaignId) { setError("Save the campaign before uploading a deck."); return; }
    if (deckJob && deckJob.phase !== "saved" && deckJob.phase !== "error") return;
    const replacingDeck = !deckId && decks.length > 0;
    if (replacingDeck && !window.confirm("Replace current deck?")) return;
    setError("");
    setDeckJob({ phase: "rendering", fileName: file.name, page: 0, total: 0, message: `Rendering ${file.name}…` });
    try {
      const pages = await renderPdfPages(file, (page, total) => {
        setDeckJob({ phase: "rendering", fileName: file.name, page, total, message: page ? `Rendering page ${page} of ${total}` : `Rendering ${file.name}…` });
      });
      setDeckJob({ phase: "uploading", fileName: file.name, page: 0, total: pages.length, message: "Uploading…" });
      const prepared = await postJson("/api/crm/interviewer/deck", deckId
        ? { action: "replace", deckId, pageCount: pages.length }
        : { action: "prepare", campaignId, fileName: file.name, pageCount: pages.length, replace: replacingDeck });
      if (!prepared.ok) {
        const message = prepared.data.fields?.file || prepared.data.fields?.campaignId || "The deck was not saved.";
        setDeckJob({ phase: "error", fileName: file.name, page: 0, total: pages.length, message });
        setError(message);
        return;
      }
      await putSlideImages(prepared.data.uploads || [], pages, (page, total) => {
        setDeckJob({ phase: "uploading", fileName: file.name, page, total, message: `Uploading ${page} of ${total}` });
      });
      setDeckJob({ phase: "notes", fileName: file.name, page: pages.length, total: pages.length, message: "Writing slide notes…" });
      const noted = await postJson("/api/crm/interviewer/deck", {
        action: "notes",
        deckId: prepared.data.deckId,
        overwrite: true,
        pageText: pages.map((page) => page.text),
      });
      await reloadDecks();
      const deckNotes = knowledgeFromDocuments(noted.data.deckNotes || []);
      if (!noted.data.deckNotesSaved && knowledgeLength(deckNotes) > 0 && knowledgeLength(sections) > 0) {
        await stageClash(deckNotes, sections);
      }
      setDeckJob({
        phase: "saved",
        fileName: file.name,
        page: pages.length,
        total: pages.length,
        message: `Saved ${file.name} · ${pages.length} pages · ${new Date().toLocaleString("en-GB")}`,
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The deck was not saved.";
      setDeckJob({ phase: "error", fileName: file.name, page: 0, total: 0, message });
      setError(message);
    }
  };

  const reloadNotes = async () => {
    const response = await fetch(`/api/crm/interviewer/documents?campaignId=${campaignId}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    const docs = data.documents || [];
    setSections(knowledgeFromDocuments(docs));
    const qualifyingNote = docs.find((doc: { title: string; body: string }) => doc.title === QUALIFYING_TITLE);
    if (qualifyingNote?.body) setQualifying(String(qualifyingNote.body));
    return docs.filter((doc: { title: string }) => KNOWLEDGE_SECTIONS.some((section) => section.title === doc.title)).length;
  };

  const saveBehaviour = async () => {
    const spoken = opener.trim() || defaultOpener(name);
    setOpener(spoken);
    const result = await postJson("/api/crm/interviewer/campaigns", {
      behaviourOnly: true,
      id: campaignId,
      quotesAllowed: quotes,
      brochureSend: brochure,
      opener: spoken,
    });
    if (campaignId) {
      await postJson("/api/crm/interviewer/documents", { campaignId, title: QUALIFYING_TITLE, body: qualifying });
    }
    setSellSaved(true);
    setNotice(result.ok ? "Saved" : "The selling settings were not saved.");
    window.setTimeout(() => setSellSaved(false), 2000);
    return result.ok;
  };

  const createInvite = async () => {
    setError("");
    const result = await postJson("/api/crm/interviewer/invites", { campaignId, prospectName, prospectEmail, expiresInHours: 24 * 7 });
    if (!result.ok || !result.data.path) { setError(result.data.fields?.prospectName || "The test link was not created."); return; }
    const link: TestLink = {
      path: String(result.data.path),
      name: String(result.data.name || prospectName.trim() || "Guest"),
      expiresAt: String(result.data.expiresAt || new Date(Date.now() + 7 * 24 * 3600_000).toISOString()),
    };
    setLinks((current) => [link, ...current.filter((item) => item.path !== link.path)]);
    setReadyPath(link.path);
  };

  const copyLink = (link: TestLink) => {
    void copyText(absoluteLink(link.path, shareQuery)).then(() => {
      setCopiedPath(link.path);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedPath(""), 2000);
    });
  };

  const openLink = (url: string) => {
    const now = Date.now();
    if (now - openedAt.current < 500) return;
    openedAt.current = now;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const saveBilling = async () => {
    const result = await postJson("/api/crm/interviewer/campaigns", {
      billingOnly: true, id: campaignId, ratePerMinute: rate, currency, marginPercent: margin, billingGranularity: granularity,
    });
    setNotice(result.ok ? "Internal billing saved." : "Billing was not saved.");
    return result.ok;
  };

  const saveAll = async () => {
    if (clashes.length) {
      setError("Resolve the differences first. Nothing else was saved.");
      return;
    }
    setError("");
    const basicsOk = await saveBasics();
    if (!basicsOk || !campaignId) return;
    const notesSaved = await saveKnowledge(false);
    const sellingSaved = await saveBehaviour();
    const billingSaved = await saveBilling();
    if (notesSaved && sellingSaved && billingSaved) {
      const pointsSaved = await saveTalkingPoints();
      setNotice(pointsSaved ? "Campaign saved." : "Campaign saved. A slide talking point was not saved.");
    }
  };

  const saveTalkingPoints = async () => {
    const deck = decks.find((item) => item.active) || decks[0];
    if (!deck) return true;
    const results = await Promise.all(deck.slides.map((slide) => postJson("/api/crm/interviewer/deck", {
      action: "point",
      deckId: deck.id,
      slideNumber: slide.number,
      talkingPoints: slide.talkingPoints || "",
    })));
    return results.every((result) => result.ok);
  };

  const regenerateHeadlines = async (deckId: string) => {
    setDeckJob({ phase: "notes", fileName: "deck", page: 0, total: 0, message: "Reading slide headlines…" });
    const result = await postJson("/api/crm/interviewer/deck", { action: "headlines", deckId });
    await reloadDecks();
    if (!result.ok) {
      setDeckJob({ phase: "error", fileName: "deck", page: 0, total: 0, message: result.data.fields?.file || "Headlines were not written." });
      return;
    }
    setNotice(`Headlines updated, ${Number(result.data.updated || 0)} slides`);
    setDeckJob({ phase: "saved", fileName: "deck", page: Number(result.data.updated || 0), total: Number(result.data.updated || 0), message: `Headlines updated, ${Number(result.data.updated || 0)} slides` });
  };

  const rebuildDeck = async (deckId: string) => {
    if (deckBusy) return;
    const deck = decks.find((item) => item.id === deckId);
    const hasWritten = (deck?.slides || []).some((slide) => customerHeadline(slide.title));
    const overwrite = hasWritten
      ? window.confirm("Replace the headlines and notes already on this deck? Cancel keeps them and only fills empty fields.")
      : false;
    setDeckJob({ phase: "notes", fileName: "deck", page: 0, total: 0, message: "Updating knowledge notes…" });
    const result = await postJson("/api/crm/interviewer/deck", { action: "rebuild", deckId, overwrite });
    await reloadDecks();
    const rawNotes = Array.isArray(result.data.deckNotes) ? result.data.deckNotes as Array<{ body?: string }> : [];
    setFreshExtract((current) => [...current.filter((item) => item.source !== "brochure"), { source: "brochure", text: rawNotes.map((note) => note.body || "").join("\n") }]);
    const deckNotes = knowledgeFromDocuments(result.data.deckNotes || []);
    const noteCount = rawNotes.length || await reloadNotes();
    if (result.ok && result.data.deckNotesSaved) await reloadNotes();
    if (result.ok && !result.data.deckNotesSaved && knowledgeLength(deckNotes) > 0 && knowledgeLength(sections) > 0) {
      await stageClash(deckNotes, sections);
    }
    if (!result.ok) {
      setDeckJob({ phase: "error", fileName: "deck", page: 0, total: 0, message: result.data.fields?.file || "The deck knowledge was not rebuilt." });
      return;
    }
    setNotice(`Knowledge updated, ${noteCount} notes`);
    setDeckJob({ phase: "saved", fileName: "deck", page: noteCount, total: noteCount, message: `Knowledge updated, ${noteCount} notes` });
  };

  const activeDeck = decks.find((deck) => deck.active) || decks[0] || null;
  const featured = links.find((link) => link.path === readyPath) || links[0] || null;
  const older = featured ? links.filter((link) => link.path !== featured.path) : [];
  const costFor = (id: string) => costs?.calls?.find((call) => call.sessionId === id);
  const knowledgeCount = knowledgeLength(sections);
  const deckBusy = Boolean(deckJob && deckJob.phase !== "saved" && deckJob.phase !== "error");
  let importHost = "the website";
  try { importHost = new URL(websiteUrl).host || importHost; } catch { /* keep the fallback */ }
  const firstSlide = activeDeck?.slides[0] || null;
  const firstHeadline = firstSlide ? customerHeadline(firstSlide.title) : "";
  const publicUrl = campaignId ? absoluteLink(publicCampaignPath(campaignId), shareQuery) : "";
  const product = parseProduct(sections.products);
  const price = parsePrice(sections.pricing);
  const pairs = parseObjections(sections.objections);
  const questions = questionLines(qualifying);
  const picked = activeDeck?.slides.find((slide) => slide.number === slidePick) || firstSlide;
  const contentDone = Boolean(name.trim()) && Boolean(sections.summary.trim()) && Boolean((opener || name).trim()) && (Boolean(activeDeck?.slides.length) || Boolean(websiteUrl.trim()));
  const productDone = Boolean(product.summary.trim()) && questions.length > 0;
  const pricingDone = Boolean(price.note.trim() || price.plans.some((plan) => plan.price.trim())) && (!quotes || Boolean(price.note.trim() || price.plans.some((plan) => plan.price.trim())));
  const objectionsDone = pairs.some((pair) => pair.hear.trim() && pair.say.trim());
  const shareDone = Boolean(campaignId) && Boolean(sections.next.trim()) && (!bookingKnown || Boolean(bookingUrl));
  const steps = [
    { n: 1, title: "Content", done: contentDone, hint: "What the agent knows before it speaks." },
    { n: 2, title: "Product", done: productDone, hint: "Who it is for, and the questions that qualify them." },
    { n: 3, title: "Pricing", done: pricingDone, hint: "The only prices the agent is allowed to say." },
    { n: 4, title: "Objections", done: objectionsDone, hint: "A ready answer when someone pushes back." },
    { n: 5, title: "Share", done: shareDone, hint: "How people start a call, and where they book." },
  ];
  const current = steps[step - 1];
  const suggestions = useMemo(() => {
    const packs = [
      ...sourceDocs.map((doc) => ({ source: doc.source, extract: extractSetup(doc.body, activeDeck?.slides || []) })),
      ...freshExtract.map((item) => ({ source: item.source, extract: extractSetup(item.text, activeDeck?.slides || []) })),
    ];
    const seen = new Set<string>();
    return packs.flatMap((pack) => suggestionsFor({
      extract: pack.extract,
      source: pack.source,
      summary: sections.summary,
      opener,
      productSummary: product.summary,
      customer: product.customer,
      benefits: product.benefits,
      disqualify: product.disqualify,
      questions,
      note: price.note,
      plans: price.plans,
      trial: price.trial,
      discount: price.discount,
      objections: pairs,
      slides: activeDeck?.slides || [],
    })).filter((item) => {
      const key = `${item.apply}|${(item.plan ? planPreview(item.plan) : item.preview).toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [activeDeck?.slides, freshExtract, opener, pairs, price.discount, price.note, price.plans, price.trial, product.benefits, product.customer, product.disqualify, product.summary, questions, sections.summary, sourceDocs]);
  const applyList = (items: Suggestion[]) => {
    setSections((now) => {
      let summary = now.summary;
      let products = parseProduct(now.products);
      let pricing = parsePrice(now.pricing);
      let objections = parseObjections(now.objections);
      for (const item of items) {
        if (item.apply === "summary" && !summary.trim()) summary = item.preview;
        if (item.apply === "product" && !products.summary.trim()) products = { ...products, summary: item.preview };
        if (item.apply === "customer" && !products.customer.trim()) products = { ...products, customer: item.preview };
        if (item.apply === "benefit" && !products.benefits.some((line) => line.toLowerCase() === item.preview.toLowerCase())) products = { ...products, benefits: [...products.benefits, item.preview] };
        if (item.apply === "disqualify" && !products.disqualify.some((line) => line.toLowerCase() === item.preview.toLowerCase())) products = { ...products, disqualify: [...products.disqualify, item.preview] };
        if (item.apply === "note" && !pricing.note.trim()) pricing = { ...pricing, note: item.preview };
        if (item.apply === "plan" && item.plan && !pricing.plans.some((plan) => plan.price === item.plan?.price && plan.period === item.plan.period && plan.name === item.plan.name)) pricing = { ...pricing, plans: [...pricing.plans, item.plan] };
        if (item.apply === "trial" && !pricing.trial.trim()) pricing = { ...pricing, trial: item.preview };
        if (item.apply === "discount" && !pricing.discount.trim()) pricing = { ...pricing, discount: item.preview };
        if (item.apply === "objection" && item.pair && !objections.some((pair) => pair.hear.toLowerCase() === item.pair?.hear.toLowerCase())) objections = [...objections, item.pair];
      }
      return { ...now, summary, products: formatProduct(products), pricing: formatPrice(pricing), objections: formatObjections(objections) };
    });
    const questionAdds = items.filter((item) => item.apply === "question").map((item) => item.preview);
    if (questionAdds.length) setQualifying((now) => formatQuestions([...questionLines(now), ...questionAdds.filter((line) => !questionLines(now).some((item) => item.toLowerCase() === line.toLowerCase()))]));
    const openerItem = items.find((item) => item.apply === "opener");
    if (openerItem && !opener.trim()) setOpener(openerItem.preview);
    for (const item of items.filter((entry) => entry.apply === "slide" && entry.slideTitle)) {
      const number = (activeDeck?.slides || []).find((slide) => slide.title === item.slideTitle)?.number || 0;
      const slide = (activeDeck?.slides || []).find((entry) => entry.number === number);
      if (number && slide && !String(slide.talkingPoints || "").trim()) editPoint(number, item.preview);
    }
  };
  const setProduct = (patch: Partial<typeof product>) => {
    setSections((now) => ({ ...now, products: formatProduct({ ...parseProduct(now.products), ...patch }) }));
  };
  const setPrice = (patch: Partial<typeof price>) => {
    setSections((now) => ({ ...now, pricing: formatPrice({ ...parsePrice(now.pricing), ...patch }) }));
  };
  const setPairs = (next: ObjectionPair[]) => {
    setSections((now) => ({ ...now, objections: formatObjections(next) }));
  };
  const setQuestions = (lines: string[]) => setQualifying(formatQuestions(lines));
  const editPoint = (number: number, talkingPoints: string) => {
    if (!activeDeck) return;
    setDecks((now) => now.map((deck) => deck.id !== activeDeck.id ? deck : {
      ...deck,
      slides: deck.slides.map((slide) => slide.number === number ? { ...slide, talkingPoints } : slide),
    }));
  };
  const factBox = (keys: string[]) => {
    const items = clashes.filter((clash) => keys.includes(clash.section));
    if (!items.length) return null;
    return (
      <div className={styles.card}>
        <p className={styles.label}>These facts disagree</p>
        <p className={styles.note}>Pick brochure, website, your own line, or keep both. Unconfirmed lines are not quoted.</p>
        <ol className={styles.stack}>
          {items.map((clash, index) => (
            <li key={clash.id}>
              <strong>{index + 1}. {clash.kind}</strong>
              <p className={styles.note}>Brochure says {clash.brochure}</p>
              <p className={styles.note}>Website says {clash.website}</p>
              <div className={styles.actions}>
                <button type="button" className={clash.choice === "brochure" ? styles.btn : styles.btnGhost} onClick={() => chooseClash(clash.id, "brochure")}>Use brochure</button>
                <button type="button" className={clash.choice === "website" ? styles.btn : styles.btnGhost} onClick={() => chooseClash(clash.id, "website")}>Use website</button>
                <button type="button" className={clash.choice === "unconfirmed" ? styles.btn : styles.btnGhost} onClick={() => chooseClash(clash.id, "unconfirmed")}>Keep both unconfirmed</button>
              </div>
              <input className={styles.field} value={clash.custom} placeholder="Or type the line to keep" onChange={(event) => chooseClash(clash.id, "custom", event.target.value)} />
            </li>
          ))}
        </ol>
        <button type="button" className={styles.btn} disabled={clashes.some((clash) => !clash.choice)} onClick={() => void saveResolved()}>Save resolved notes</button>
      </div>
    );
  };

  return (
    <main className={`${styles.page} ${styles.studioPage}`}>
      <p className={styles.studioBack}><a className={styles.link} href="/crm/interviewer">All campaigns</a></p>
      <section className={styles.hero}>
        <div className={styles.headRow}>
          <h1 className={styles.h1}>{name || "New campaign"}</h1>
          <span className={creating ? styles.warn : styles.ok}>{creating ? "New" : "Active"}</span>
        </div>
        <p className={styles.lede}>{voiceId ? voiceLabel(voiceId) : "Choose a voice in Advanced."}</p>
      </section>
      <div className={styles.stepRail} role="tablist" aria-label="Campaign setup">
        {steps.map((item) => (
          <button
            key={item.n}
            type="button"
            role="tab"
            aria-selected={step === item.n}
            className={step === item.n ? styles.stepTabOn : styles.stepTab}
            onClick={() => setStep(item.n)}
          >
            {item.n} {item.title}
            <span className={item.done ? styles.ok : styles.warn}>{item.done ? "Done" : "Needs attention"}</span>
          </button>
        ))}
      </div>
      {notice ? <p className={styles.note}>{notice}</p> : null}
      {error ? <p className={styles.err}>{error}</p> : null}

      <section className={styles.step} role="tabpanel">
        <header className={styles.stepHead}>
          <span className={styles.stepNum}>{current.n}</span>
          <div>
            <h2>{current.title}</h2>
            <p>{current.hint}</p>
          </div>
          <span className={current.done ? styles.ok : styles.warn}>{current.done ? "Done" : "Needs attention"}</span>
        </header>
        <div className={styles.stepBody}>
          {step === 1 ? (
            <>
              <SuggestBox step={1} items={suggestions} onApply={(item) => applyList([item])} onAll={() => applyList(suggestions.filter((item) => item.step === 1))} />
              {factBox(["summary"])}
              <div className={styles.studioName}>
                <label className={styles.label}>Campaign name<input className={styles.field} value={name} placeholder="Adam for dental practices" onChange={(event) => setName(event.target.value)} /></label>
                <label className={styles.label}>Call limit, minutes<input className={styles.field} value={maxMinutes} placeholder="30" onChange={(event) => setMaxMinutes(event.target.value)} /></label>
                <button type="button" className={styles.btn} onClick={() => void saveBasics()}>Save name</button>
              </div>
              <div className={styles.inlineField}>
                <label className={styles.label}>Website
                  <input className={styles.field} value={websiteUrl} placeholder="https://example.com" onChange={(event) => setWebsiteUrl(event.target.value)} />
                </label>
                <button type="button" className={styles.btnGhost} disabled={importing} onClick={() => void importSite()}>
                  {importing ? `Scanning ${importHost}…` : "Scan website"}
                </button>
              </div>
              <p className={styles.note}>{websiteUrl ? "Nothing is scanned until you choose Scan website." : "No website yet. A brochure can fill this in."} {scrapedAt ? `Last scanned ${new Date(scrapedAt).toLocaleString("en-GB")}.` : ""}</p>
              {fetchedPages.length ? (
                <ul className={styles.stack}>
                  {fetchedPages.map((page) => (
                    <li key={page.url} className={styles.note}>{page.url} · {page.chars.toLocaleString("en-GB")} characters</li>
                  ))}
                </ul>
              ) : null}
              <p className={styles.label}>Brochure</p>
              <input className={styles.filePick} type="file" accept="application/pdf,.pdf" aria-label="Brochure PDF" disabled={deckBusy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadDeck(file); }} />
              {activeDeck ? (
                <div className={styles.actions}>
                  <strong>{activeDeck.title}</strong>
                  <button type="button" className={styles.btn} disabled={deckBusy} onClick={() => void rebuildDeck(activeDeck.id)}>
                    {deckJob?.phase === "notes" ? "Updating knowledge notes…" : "Rebuild knowledge from deck"}
                  </button>
                  <button type="button" className={styles.btnGhost} disabled={deckBusy} onClick={() => void regenerateHeadlines(activeDeck.id)}>Regenerate headlines</button>
                </div>
              ) : <p className={styles.note}>No brochure yet.</p>}
              {deckNote ? <p className={deckNote.startsWith("No deck") ? styles.note : styles.err}>{deckNote}</p> : null}
              {deckJob ? <p className={deckJob.phase === "error" ? styles.err : styles.note}>{deckJob.message}</p> : null}
              <div className={styles.pair}>
                <label className={styles.label}>Key message
                  <textarea className={styles.area} value={sections.summary} placeholder="One or two sentences a caller should remember." onChange={(event) => setSections({ ...sections, summary: event.target.value })} />
                </label>
                <div>
                  <label className={styles.label}>Opener
                    <span className={styles.note}>The first thing the agent says when the call connects.</span>
                    <input className={styles.field} value={opener || defaultOpener(name)} onChange={(event) => setOpener(event.target.value)} />
                  </label>
                  <p className={styles.sayPreview}>The agent will open with: {opener || defaultOpener(name)}</p>
                </div>
              </div>
              {picked ? (
                <div className={styles.slideEdit}>
                  {picked.url && !picked.missing ? <img src={picked.url} alt={customerHeadline(picked.title) || `Slide ${picked.number}`} /> : <div className={styles.thumb} />}
                  <label className={styles.label}>Talking point for slide {picked.number}
                    <textarea className={styles.area} value={picked.talkingPoints || ""} placeholder="One sentence about this slide, tied to their business." onChange={(event) => editPoint(picked.number, event.target.value)} />
                  </label>
                </div>
              ) : null}
              {activeDeck?.slides.length ? (
                <div className={styles.thumbs}>
                  {activeDeck.slides.map((slide) => {
                    const headline = customerHeadline(slide.title);
                    return (
                      <button key={`${activeDeck.id}-${slide.number}`} type="button" className={slide.number === picked?.number ? styles.thumbOn : styles.thumbBtn} onClick={() => setSlidePick(slide.number)}>
                        {slide.url && !slide.missing ? <img src={slide.url} alt="" /> : <span className={styles.thumb} />}
                        <span className={styles.thumbTitle}>{headline || "Needs a headline"}</span>
                        <span className={styles.thumbMeta}>Slide {slide.number}{slide.talkingPoints?.trim() ? "" : " · no point"}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <p className={styles.note}>{!sections.summary.trim() ? "Add a key message. " : ""}{!websiteUrl.trim() && !activeDeck?.slides.length ? "Add a website or a brochure. " : ""}{activeDeck?.slides.some((slide) => !slide.talkingPoints?.trim()) ? "Some slides have no talking point." : ""}</p>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <SuggestBox step={2} items={suggestions} onApply={(item) => applyList([item])} onAll={() => applyList(suggestions.filter((item) => item.step === 2))} />
              {factBox(["products"])}
              <label className={styles.label}>Product
                <textarea className={styles.area} value={product.summary} placeholder="What you sell, in one short paragraph." onChange={(event) => setProduct({ summary: event.target.value })} />
              </label>
              <label className={styles.label}>Ideal customer
                <input className={styles.field} value={product.customer} placeholder="A team of about 10 that sells from a website." onChange={(event) => setProduct({ customer: event.target.value })} />
              </label>
              <p className={styles.label}>Key benefits</p>
              {product.benefits.map((benefit, index) => (
                <div key={`benefit-${index}`} className={styles.lineRow}>
                  <input className={styles.field} value={benefit} placeholder="A concrete win" onChange={(event) => setProduct({ benefits: product.benefits.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} />
                  <button type="button" className={styles.btnGhost} onClick={() => setProduct({ benefits: product.benefits.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
                </div>
              ))}
              <button type="button" className={styles.btnGhost} onClick={() => setProduct({ benefits: [...product.benefits, ""] })}>Add benefit</button>
              <p className={styles.label}>Qualifying questions</p>
              <p className={styles.note}>Asked one at a time, after the lead has answered.</p>
              {questions.map((question, index) => (
                <div key={`question-${index}`} className={styles.lineRow}>
                  <input className={styles.field} value={question} onChange={(event) => setQuestions(questions.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />
                  <button type="button" className={styles.btnGhost} onClick={() => setQuestions(questions.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
                  <button type="button" className={styles.btnGhost} disabled={index === 0} onClick={() => {
                    const next = [...questions];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    setQuestions(next);
                  }}>Up</button>
                </div>
              ))}
              <div className={styles.actions}>
                <button type="button" className={styles.btnGhost} onClick={() => setQuestions([...questions, ""])}>Add question</button>
                <button type="button" className={styles.btnGhost} onClick={() => setQuestions([...questions, ...DEFAULT_QUALIFYING_QUESTIONS.filter((item) => !questions.includes(item))])}>Add suggested questions</button>
              </div>
              <p className={styles.label}>Disqualifiers</p>
              <p className={styles.note}>The agent should not push a booking when one of these is true.</p>
              {product.disqualify.map((line, index) => (
                <div key={`stop-${index}`} className={styles.lineRow}>
                  <input className={styles.field} value={line} placeholder="They only want a human team" onChange={(event) => setProduct({ disqualify: product.disqualify.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} />
                  <button type="button" className={styles.btnGhost} onClick={() => setProduct({ disqualify: product.disqualify.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
                </div>
              ))}
              <button type="button" className={styles.btnGhost} onClick={() => setProduct({ disqualify: [...product.disqualify, ""] })}>Add disqualifier</button>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <SuggestBox step={3} items={suggestions} onApply={(item) => applyList([item])} onAll={() => applyList(suggestions.filter((item) => item.step === 3))} />
              {factBox(["pricing"])}
              <p className={styles.sayPreview}>{priceSpeech(quotes, price)}</p>
              <label className={styles.label}>Pricing note
                <textarea className={styles.area} value={price.note} placeholder="£39 a month for 111 minutes. Say it only if quotes are on." onChange={(event) => setPrice({ note: event.target.value })} />
              </label>
              <p className={styles.label}>Plans</p>
              {price.plans.map((plan, index) => (
                <div key={`plan-${index}`} className={styles.planRow}>
                  <input className={styles.field} value={plan.name} placeholder="Name" onChange={(event) => setPrice({ plans: price.plans.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
                  <input className={styles.field} value={plan.price} placeholder="£39" onChange={(event) => setPrice({ plans: price.plans.map((item, itemIndex) => itemIndex === index ? { ...item, price: event.target.value } : item) })} />
                  <input className={styles.field} value={plan.period} placeholder="monthly" onChange={(event) => setPrice({ plans: price.plans.map((item, itemIndex) => itemIndex === index ? { ...item, period: event.target.value } : item) })} />
                  <input className={styles.field} value={plan.includes} placeholder="111 minutes" onChange={(event) => setPrice({ plans: price.plans.map((item, itemIndex) => itemIndex === index ? { ...item, includes: event.target.value } : item) })} />
                  <input className={styles.field} value={plan.overage} placeholder="Overage" onChange={(event) => setPrice({ plans: price.plans.map((item, itemIndex) => itemIndex === index ? { ...item, overage: event.target.value } : item) })} />
                  <button type="button" className={styles.btnGhost} onClick={() => setPrice({ plans: price.plans.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
                </div>
              ))}
              <button type="button" className={styles.btnGhost} onClick={() => setPrice({ plans: [...price.plans, { name: "", price: "", period: "", includes: "", overage: "" } satisfies PricePlan] })}>Add plan</button>
              <div className={styles.pair}>
                <label className={styles.label}>Trial
                  <input className={styles.field} value={price.trial} placeholder="A trial can be set up on a later call." onChange={(event) => setPrice({ trial: event.target.value })} />
                </label>
                <label className={styles.label}>Discount
                  <input className={styles.field} value={price.discount} placeholder="No discount unless it is written here." onChange={(event) => setPrice({ discount: event.target.value })} />
                </label>
              </div>
              <label className={styles.label}>Do not say
                <input className={styles.field} value={price.avoid} placeholder="Do not mention internal cost or a supplier." onChange={(event) => setPrice({ avoid: event.target.value })} />
              </label>
              <div className={styles.switchRow}>
                <label className={styles.switch}>
                  <input type="checkbox" checked={quotes} onChange={(event) => setQuotes(event.target.checked)} />
                  <span>Quotes allowed<span className={styles.note}>The agent may say a price that is written in the notes.</span></span>
                </label>
                <label className={styles.switch}>
                  <input type="checkbox" checked={brochure} onChange={(event) => setBrochure(event.target.checked)} />
                  <span>Brochure send allowed<span className={styles.note}>The agent may offer to send the brochure. It will not say it has already been sent.</span></span>
                </label>
              </div>
              <button type="button" className={styles.btn} disabled={creating} onClick={() => void saveBehaviour()}>{sellSaved ? "Saved" : "Save"}</button>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <SuggestBox step={4} items={suggestions} onApply={(item) => applyList([item])} onAll={() => applyList(suggestions.filter((item) => item.step === 4))} />
              {factBox(["faqs", "objections"])}
              <p className={styles.note}>One objection, one answer. The agent uses these words, not a speech it invents.</p>
              {pairs.map((pair, index) => (
                <div key={`pair-${index}`} className={styles.pairCard}>
                  <label className={styles.label}>When they say
                    <input className={styles.field} value={pair.hear} placeholder="It costs too much" onChange={(event) => setPairs(pairs.map((item, itemIndex) => itemIndex === index ? { ...item, hear: event.target.value } : item))} />
                  </label>
                  <label className={styles.label}>Say
                    <textarea className={styles.area} value={pair.say} placeholder="The price on this page is the one to use." onChange={(event) => setPairs(pairs.map((item, itemIndex) => itemIndex === index ? { ...item, say: event.target.value } : item))} />
                  </label>
                  <button type="button" className={styles.btnGhost} onClick={() => setPairs(pairs.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
                </div>
              ))}
              <div className={styles.actions}>
                <button type="button" className={styles.btnGhost} onClick={() => setPairs([...pairs, { hear: "", say: "" }])}>Add objection</button>
                <button type="button" className={styles.btnGhost} onClick={() => setPairs([...pairs, ...STARTER_OBJECTIONS.filter((item) => !pairs.some((pair) => pair.hear === item.hear))])}>Add starter objections</button>
              </div>
              <label className={styles.label}>FAQs and objections
                <textarea className={styles.area} value={sections.faqs} placeholder="Short extra answers that are not a full objection." onChange={(event) => setSections({ ...sections, faqs: event.target.value })} />
              </label>
              {knowledgeCount >= KNOWLEDGE_CHAR_CAP * 0.8 ? (
                <p className={knowledgeCount >= KNOWLEDGE_CHAR_CAP ? styles.err : styles.note}>
                  Knowledge is {knowledgeCount.toLocaleString("en-GB")} characters. The call uses the first {KNOWLEDGE_CHAR_CAP.toLocaleString("en-GB")}.
                </p>
              ) : null}
              <button type="button" className={styles.btn} onClick={() => void saveKnowledge(false)}>Save knowledge</button>
            </>
          ) : null}

          {step === 5 ? (
            <>
              {factBox(["next"])}
              <h2 className={styles.cardTitle}>Share link</h2>
              <p className={styles.note}>Name and email, then the call starts. No login.</p>
              {publicUrl ? (
                <>
                  <div className={styles.shareRow}>
                    <div>
                      <button type="button" className={styles.linkField} onClick={() => openLink(publicUrl)}>{publicUrl}</button>
                      <div className={styles.linkActions}>
                        <button type="button" className={styles.btn} onClick={() => { void copyText(publicUrl).then(() => { setShareCopied(true); window.setTimeout(() => setShareCopied(false), 1500); }); }}>{shareCopied ? "Copied" : "Copy link"}</button>
                        <button type="button" className={styles.btnGhost} onClick={() => { void copyText(`<a href="${publicUrl}">Talk to us</a>`); }}>Copy embed</button>
                      </div>
                      {shareQuery ? <p className={styles.note}>This preview link includes Vercel’s access pass, so someone outside the team can open it.</p> : null}
                    </div>
                    <div className={styles.qr} dangerouslySetInnerHTML={{ __html: renderSVG(publicUrl, { pixelSize: 3, whiteColor: "#ffffff", blackColor: "#101828" }) }} />
                  </div>
                  <label className={styles.switch}>
                    <input
                      type="checkbox"
                      checked={acceptingCalls}
                      onChange={(event) => {
                        const next = event.target.checked;
                        setAcceptingCalls(next);
                        void postJson("/api/crm/interviewer/campaigns", { id: campaignId, publicCallsOnly: true, acceptingCalls: next }).then((result) => {
                          if (!result.ok) {
                            setAcceptingCalls(!next);
                            setError(result.data.reason || "Public calls were not changed. The previous setting is still in place.");
                          }
                        });
                      }}
                    />
                    <span>Public calls on<span className={styles.note}>Off keeps the page up. Calls already started stay open.</span></span>
                  </label>
                </>
              ) : <p className={styles.note}>Save the campaign name first. Then the share link appears here.</p>}
              <label className={styles.label}>Next step and booking
                <textarea className={styles.area} value={sections.next} placeholder="The best next step is a 20-minute demo." onChange={(event) => setSections({ ...sections, next: event.target.value })} />
              </label>
              <p className={bookingUrl ? styles.note : styles.err}>{!bookingKnown ? "Checking the booking calendar." : bookingUrl ? "When a call ends, this tab opens the owner’s booking calendar." : "No booking link is saved on the owner’s sales profile. Calls will end on a thank-you page."}</p>
              <div className={`${styles.inlineField} ${styles.inlineWide}`}>
                <label className={styles.label}>Lead name<input className={styles.field} value={prospectName} onChange={(event) => setProspectName(event.target.value)} /></label>
                <label className={styles.label}>Email, optional<input className={styles.field} value={prospectEmail} onChange={(event) => setProspectEmail(event.target.value)} /></label>
                <button type="button" className={styles.btn} disabled={creating} onClick={() => void createInvite()}>Create test link</button>
              </div>
              {featured ? <TestLinkBlock link={featured} featured shareQuery={shareQuery} copied={copiedPath === featured.path} onCopy={() => copyLink(featured)} onOpen={openLink} /> : null}
              {older.length ? (
                <div className={styles.linkList}>
                  <p className={styles.label}>Earlier links</p>
                  {older.map((link) => (
                    <TestLinkBlock key={link.path} link={link} shareQuery={shareQuery} copied={copiedPath === link.path} onCopy={() => copyLink(link)} onOpen={openLink} />
                  ))}
                </div>
              ) : null}
              <ul className={styles.stack}>
                <li className={campaignId ? styles.note : styles.err}>{campaignId ? "Share link is ready." : "Save the name to create the share link."}</li>
                <li className={styles.note}>{acceptingCalls ? "Public calls are on." : "Public calls are off."}</li>
                <li className={sections.next.trim() ? styles.note : styles.err}>{sections.next.trim() ? "Booking line is written." : "Write the booking line."}</li>
              </ul>
            </>
          ) : null}
        </div>
        <div className={styles.stepNav}>
          <button type="button" className={styles.btnGhost} disabled={step === 1} onClick={() => setStep((value) => Math.max(1, value - 1))}>Back</button>
          <button type="button" className={styles.btn} disabled={step === 5} onClick={() => setStep((value) => Math.min(5, value + 1))}>Next</button>
        </div>
      </section>

      <button type="button" className={styles.btnGhost} aria-expanded={showAdvanced} onClick={() => setShowAdvanced((open) => !open)}>
        {showAdvanced ? "Hide advanced" : "Advanced"}
      </button>
      {showAdvanced ? (
        <div className={styles.stack}>
          <Fold title="Voices" open={openSections.voices !== false} onToggle={() => toggleSection("voices")}>
            <p className={styles.note}>Tick the voices this account may use, then choose one for this campaign. Tags are Deepgram’s own.</p>
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
            {offered.map((voice) => (
              <label key={voice.id} className={styles.switch}>
                <input type="radio" name="campaign-voice" checked={voiceId === voice.id} onChange={() => setVoiceId(voice.id)} />
                <span style={{ textTransform: "capitalize" }}>{voice.name}</span>
                <span className={styles.note}>{voice.accent} · {voice.gender}</span>
                <button type="button" className={styles.btnGhost} onClick={() => void play(voice.id)}>Play</button>
              </label>
            ))}
            <button type="button" className={styles.btn} onClick={() => void saveBasics()}>Save voice</button>
          </Fold>
          <Fold title={`Calls${calls.length ? ` · ${calls.length}` : ""}`} open={Boolean(openSections.calls)} onToggle={() => toggleSection("calls")}>
            <ul className={styles.stack} style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {calls.map((call) => {
                const cost = costFor(call.id);
                const tone = call.disposition === "Hot" ? styles.org : call.disposition === "Warm" ? styles.warn : styles.pill;
                return (
                  <li key={call.id} className={styles.headRow}>
                    <a className={styles.link} href={`/crm/interviewer/calls/${call.id}`}>{new Date(call.created_at).toLocaleString("en-GB")}</a>
                    <span className={tone}>{call.disposition || "No outcome"}</span>
                    <span className={styles.note}>{formatCallLength(call.billable_seconds || 0)}{cost ? ` · ${cost.cost}${cost.estimated ? " estimate" : ""}` : ""}</span>
                  </li>
                );
              })}
            </ul>
          </Fold>
          <Fold title="Billing" open={Boolean(openSections.billing)} onToggle={() => toggleSection("billing")}>
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
            <div className={styles.scrollX}>
              <table className={styles.table}>
                <thead><tr><th>Item</th><th>Amount</th><th>Detail</th></tr></thead>
                <tbody>
                  {(costs?.setup || []).map((item) => (
                    <tr key={item.kind}><td>{item.kind}</td><td>{item.amount}</td><td>{item.detail}</td></tr>
                  ))}
                  {(costs?.calls || []).map((call) => (
                    <tr key={call.sessionId}><td>Call</td><td>{call.cost}{call.estimated ? " estimate" : ""}</td><td>{call.seconds}s</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Fold>
        </div>
      ) : null}
      <div className={styles.saveBar}>
        <p>{error || notice || "Saves the name, notes, selling settings, talking points, and billing."}</p>
        <button type="button" className={styles.btn} onClick={() => void saveAll()}>Save campaign</button>
      </div>
    </main>
  );
}

