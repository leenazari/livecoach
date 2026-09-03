"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NavMenu from "@/components/crm/NavMenu";
import { crmFetch } from "@/lib/crm";
import MatrixRain from "@/components/MatrixRain";

type Chapter = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
  kind?: "principle" | "sales_call" | "field_note";
  status?: "draft" | "approved" | "archived";
  visibility?: "private" | "team";
  canEdit?: boolean;
  sourceKind?: "sales_call" | "field_note";
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  sourceSummary?: string;
  principle?: string;
  liveCoachSafeguard?: string;
  calibrationLevels?: Array<{
    level: string;
    signals: string[];
    sellerMove: string;
  }>;
  diagnosticQuestions?: string[];
  knowledgeChecks?: Array<{ question: string; answer: string }>;
  mode?: "prospect_demo" | "commercial_partner";
  callId?: string;
  callDate?: string;
  company?: string | null;
  candidate?: string | null;
  scenario?: string;
  audience?: string;
  buyerLanguage?: string[];
  questionsThatWorked?: string[];
  pitchMoves?: string[];
  objections?: { signal: string; response: string }[];
  buyingSignals?: string[];
  avoid?: string[];
  script?: string[];
};

type ReviewCandidate = {
  id: string;
  candidate: string | null;
  role: string | null;
  company: string | null;
  companyId: string | null;
  createdAt: string;
  callType: string;
  score: number;
  reasons: string[];
  suggestedMode: "prospect_demo" | "commercial_partner";
  durationSeconds: number | null;
  evidenceCount: number;
  transcriptChars: number;
};

const safeList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()) : [];

const pdfText = (value: unknown) =>
  String(value || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•·]/g, "-")
    .replace(/↗/g, "")
    .replace(/✓/g, "Yes")
    .replace(/\s+/g, " ")
    .trim();

const chapterSearchText = (chapter: Chapter) =>
  [
    chapter.title,
    chapter.company,
    chapter.candidate,
    chapter.scenario,
    chapter.audience,
    chapter.sourceLabel,
    chapter.sourceSummary,
    chapter.principle,
    chapter.liveCoachSafeguard,
    ...(chapter.calibrationLevels || []).flatMap((item) => [
      item.level,
      ...safeList(item.signals),
      item.sellerMove,
    ]),
    ...safeList(chapter.diagnosticQuestions),
    ...(chapter.knowledgeChecks || []).flatMap((item) => [item.question, item.answer]),
    ...safeList(chapter.buyerLanguage),
    ...safeList(chapter.questionsThatWorked),
    ...safeList(chapter.pitchMoves),
    ...safeList(chapter.buyingSignals),
    ...safeList(chapter.avoid),
    ...safeList(chapter.script),
    ...(Array.isArray(chapter.objections)
      ? chapter.objections.flatMap((item) => [item?.signal, item?.response])
      : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

async function downloadPlaybookPdf(chapters: Chapter[], fileName: string, documentTitle: string) {
  if (!chapters.length) return;
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const left = 18;
  const width = 174;
  const bottom = 278;
  let y = 18;

  const addPage = () => {
    doc.addPage();
    y = 18;
  };
  const ensure = (height: number) => {
    if (y + height > bottom) addPage();
  };
  const write = (value: unknown, size = 10, style: "normal" | "bold" = "normal", gap = 2) => {
    const text = pdfText(value);
    if (!text) return;
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(style === "bold" ? 28 : 66, style === "bold" ? 43 : 74, style === "bold" ? 38 : 72);
    const lines = doc.splitTextToSize(text, width);
    const height = lines.length * (size * 0.38 + 1.25);
    ensure(height + gap);
    doc.text(lines, left, y);
    y += height + gap;
  };
  const section = (title: string, values: string[]) => {
    if (!values.length) return;
    ensure(13);
    y += 1;
    write(title.toUpperCase(), 8, "bold", 1.5);
    for (const item of values) write(`- ${item}`, 9.5, "normal", 1.5);
    y += 1;
  };

  doc.setFillColor(25, 38, 34);
  doc.rect(0, 0, 210, 56, "F");
  doc.setTextColor(226, 181, 92);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("INTERVIEWA SALES TRAINING", left, 20);
  doc.setTextColor(247, 244, 235);
  doc.setFontSize(24);
  doc.text(doc.splitTextToSize(pdfText(documentTitle), width), left, 32);
  y = 68;
  write(`${chapters.length} curated ${chapters.length === 1 ? "lesson" : "lessons"} from approved field sources and real conversations`, 11, "bold", 3);
  write(`Downloaded ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}. Use these patterns as grounded guidance, then adapt them to the buyer in front of you.`, 10, "normal", 4);

  chapters.forEach((chapter, index) => {
    addPage();
    doc.setTextColor(174, 128, 48);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(`LESSON ${index + 1} OF ${chapters.length}`, left, y);
    y += 7;
    write(chapter.title, 17, "bold", 3);
    const meta = [
      chapter.sourceKind === "field_note"
        ? "Field lesson"
        : chapter.mode === "commercial_partner"
          ? "Commercial partner"
          : "Prospect or demo",
      chapter.callDate ? new Date(chapter.callDate).toLocaleDateString("en-GB") : "",
      chapter.candidate || "",
      chapter.sourceLabel || "",
    ].filter(Boolean);
    write(meta.join(" | "), 8.5, "normal", 4);
    if (chapter.sourceSummary) section("Source insight", [chapter.sourceSummary]);
    if (chapter.principle) section("Operating principle", [chapter.principle]);
    if (chapter.liveCoachSafeguard) section("LiveCoach safeguard", [chapter.liveCoachSafeguard]);
    if (chapter.scenario) section("When to use this", [chapter.scenario]);
    if (chapter.audience) section("Useful with", [chapter.audience]);
    if (chapter.calibrationLevels?.length) {
      section(
        "Calibration guide",
        chapter.calibrationLevels.map(
          (item) => `${item.level}. Notice: ${safeList(item.signals).join(", ")}. Adapt: ${item.sellerMove}`
        )
      );
    }
    section("Buyer language", safeList(chapter.buyerLanguage));
    section(
      chapter.sourceKind === "field_note" ? "Diagnostic questions" : "Seller questions that worked",
      chapter.sourceKind === "field_note"
        ? safeList(chapter.diagnosticQuestions)
        : safeList(chapter.questionsThatWorked)
    );
    section("Pitch moves", safeList(chapter.pitchMoves));
    section("Buying signals", safeList(chapter.buyingSignals));
    if (Array.isArray(chapter.objections) && chapter.objections.length) {
      section(
        "Objections and responses",
        chapter.objections.map((item) => `${item.signal} Response: ${item.response}`)
      );
    }
    section(
      "Reusable conversation path",
      safeList(chapter.script).map((line, lineIndex) => `${lineIndex + 1}. ${line}`)
    );
    section("Avoid next time", safeList(chapter.avoid));
    if (chapter.knowledgeChecks?.length) {
      section(
        "Knowledge check",
        chapter.knowledgeChecks.map((item) => `${item.question} Answer: ${item.answer}`)
      );
    }
  });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(220, 216, 204);
    doc.line(left, 288, 192, 288);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(105, 105, 100);
    doc.text("Interviewa sales knowledge base", left, 293);
    doc.text(`${page} / ${pages}`, 192, 293, { align: "right" });
  }
  doc.save(fileName);
}

export default function PitchPlaybookPage() {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [reviewQueue, setReviewQueue] = useState<ReviewCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modes, setModes] = useState<Record<string, "prospect_demo" | "commercial_partner">>({});
  const [queuePage, setQueuePage] = useState(0);
  const [building, setBuilding] = useState(false);
  const [buildNote, setBuildNote] = useState("");
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState("");
  const [canManageTeamKnowledge, setCanManageTeamKnowledge] = useState(false);
  const [showFieldNote, setShowFieldNote] = useState(false);
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [fieldNoteBusy, setFieldNoteBusy] = useState(false);
  const [knowledgeBusy, setKnowledgeBusy] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    return crmFetch<{
      chapters: Chapter[];
      reviewQueue: ReviewCandidate[];
      canManageTeamKnowledge: boolean;
    }>("/api/crm/pitch-playbook")
      .then((data) => {
        const nextChapters = Array.isArray(data.chapters) ? data.chapters : [];
        const nextQueue = Array.isArray(data.reviewQueue) ? data.reviewQueue : [];
        setChapters(nextChapters);
        setReviewQueue(nextQueue);
        setCanManageTeamKnowledge(data.canManageTeamKnowledge === true);
        setModes(Object.fromEntries(nextQueue.map((call) => [call.id, call.suggestedMode])));
        setQueuePage(0);
      })
      .catch((err) => setError(err?.message || "Could not load the playbook"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!chapters.length || typeof window === "undefined") return;
    const lessonId = new URLSearchParams(window.location.search).get("lesson");
    if (!lessonId) return;
    window.setTimeout(() => {
      document.getElementById(`lesson-${lessonId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, [chapters]);

  const filteredChapters = useMemo(() => {
    const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return chapters;
    return chapters.filter((chapter) => {
      const haystack = chapterSearchText(chapter);
      return terms.every((term) => haystack.includes(term));
    });
  }, [chapters, search]);

  const downloadPdf = async (items: Chapter[], key: string, title: string) => {
    if (!items.length || downloading) return;
    setDownloading(key);
    setError("");
    try {
      const suffix = new Date().toISOString().slice(0, 10);
      const fileName = key === "all"
        ? `interviewa-pitching-playbook-${suffix}.pdf`
        : `interviewa-pitching-lesson-${key.slice(0, 8)}.pdf`;
      await downloadPlaybookPdf(items, fileName, title);
    } catch (err: any) {
      setError(err?.message || "Could not download the playbook PDF");
    } finally {
      setDownloading("");
    }
  };

  const visibleQueue = reviewQueue.slice(queuePage * 5, queuePage * 5 + 5);
  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  };

  const buildSelected = async () => {
    if (!selected.size || building) return;
    const calls = reviewQueue.filter((call) => selected.has(call.id)).slice(0, 5);
    setBuilding(true);
    setBuildNote(`Building 1 of ${calls.length}…`);
    let built = 0;
    const failures: string[] = [];
    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      setBuildNote(`Building ${index + 1} of ${calls.length}: ${call.company || call.candidate || "call"}…`);
      try {
        await crmFetch("/api/crm/pitch-playbook", {
          method: "POST",
          body: JSON.stringify({ callId: call.id, mode: modes[call.id] || call.suggestedMode }),
        });
        built += 1;
      } catch (error: any) {
        failures.push(`${call.company || call.candidate || "Call"}: ${error?.message || "failed"}`);
      }
    }
    setSelected(new Set());
    await load();
    setBuildNote(
      failures.length
        ? `${built} ${built === 1 ? "lesson" : "lessons"} built. ${failures.join(" ")}`
        : `${built} ${built === 1 ? "lesson" : "lessons"} added to the playbook.`
    );
    setBuilding(false);
  };

  const buildFieldNote = async () => {
    if (fieldNoteBusy || sourceContent.trim().length < 120) return;
    setFieldNoteBusy(true);
    setError("");
    setBuildNote("Building a private lesson for review…");
    try {
      const result = await crmFetch<{ id: string }>("/api/crm/pitch-playbook", {
        method: "POST",
        body: JSON.stringify({
          kind: "field_note",
          sourceTitle,
          sourceLabel,
          sourceUrl,
          sourceContent,
        }),
      });
      setSourceTitle("");
      setSourceLabel("");
      setSourceUrl("");
      setSourceContent("");
      setShowFieldNote(false);
      await load();
      setBuildNote(
        "Private lesson built. Review it below, then publish it to the team when the interpretation is right."
      );
      window.setTimeout(() => {
        document.getElementById(`lesson-${result.id}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 120);
    } catch (err: any) {
      setError(err?.message || "Could not build that field lesson");
      setBuildNote("");
    } finally {
      setFieldNoteBusy(false);
    }
  };

  const changeKnowledgeAccess = async (
    chapter: Chapter,
    action: "publish_team" | "make_private" | "archive"
  ) => {
    if (knowledgeBusy) return;
    setKnowledgeBusy(chapter.id);
    setError("");
    setBuildNote("");
    try {
      const { lesson } = await crmFetch<{
        lesson: { id: string; status: Chapter["status"]; visibility: Chapter["visibility"] };
      }>(`/api/crm/lessons/${chapter.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      if (!lesson?.id) throw new Error("LiveCoach did not confirm the knowledge change");
      await load();
      setBuildNote(
        action === "publish_team"
          ? "Lesson published to the sales team and available to relevant Brain call preparation."
          : action === "make_private"
            ? "Lesson is private and no longer available to the sales team."
            : "Lesson archived."
      );
    } catch (err: any) {
      setError(err?.message || "That knowledge change did not save");
    } finally {
      setKnowledgeBusy("");
    }
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds || seconds <= 0) return "Duration unavailable";
    return `${Math.max(1, Math.round(seconds / 60))} minutes`;
  };

  const List = ({ title, items, tone = "text-bone/80" }: { title: string; items: string[]; tone?: string }) =>
    items.length ? (
      <div>
        <p className="mb-1.5 font-mono text-[0.56rem] uppercase tracking-[0.17em] text-muted">{title}</p>
        <ul className={`space-y-1.5 text-[0.82rem] leading-snug ${tone}`}>
          {items.map((item, index) => <li key={index}>• {item}</li>)}
        </ul>
      </div>
    ) : null;

  return (
    <main className="relative z-10 mx-auto max-w-[1040px] px-4 py-8 sm:px-6">
      <NavMenu />
      <header className="mb-6 flex flex-col gap-3 border-b border-edge pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-sage">Sales training</p>
          <h1 className="mt-1 font-display text-3xl text-bone">Interviewa sales knowledge base</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Approved field lessons and proven patterns from real calls, turned into practical guidance the sales team and Brain can retrieve when relevant.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {canManageTeamKnowledge ? (
            <button
              type="button"
              onClick={() => setShowFieldNote((open) => !open)}
              className="rounded-full border border-sky/55 bg-sky/10 px-4 py-2 font-mono text-[0.6rem] uppercase text-sky hover:bg-sky/20"
            >
              {showFieldNote ? "Close field lesson" : "+ Add field lesson"}
            </button>
          ) : null}
          <Link href="/crm/calls" className="rounded-full border border-edge px-4 py-2 font-mono text-[0.6rem] uppercase text-muted hover:border-amber/50 hover:text-amber">
            Choose a call
          </Link>
          <button type="button" onClick={() => downloadPdf(chapters.filter((chapter) => chapter.status === "approved"), "all", "Interviewa sales knowledge base")} disabled={!chapters.some((chapter) => chapter.status === "approved") || !!downloading} className="rounded-full border border-amber/55 bg-amber/10 px-4 py-2 font-mono text-[0.6rem] uppercase text-amber hover:bg-amber/20 disabled:opacity-35">
            {downloading === "all" ? "Building PDF…" : "Download PDF"}
          </button>
          <button type="button" onClick={() => window.print()} className="rounded-full border border-sage/50 bg-sage/10 px-4 py-2 font-mono text-[0.6rem] uppercase text-sage hover:bg-sage/20">
            Print
          </button>
        </div>
      </header>

      {showFieldNote && canManageTeamKnowledge ? (
        <section className="mb-6 rounded-2xl border border-sky/40 bg-sky/[0.05] p-4 sm:p-5 print:hidden">
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-sky">External field lesson</p>
          <h2 className="mt-1 font-display text-xl text-bone">Turn a useful post, article or note into training</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            LiveCoach creates a private structured draft first. It stores the distilled lesson and source attribution, not the copied article. Review the result before publishing it to the team.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-muted">
              Source title
              <input
                value={sourceTitle}
                onChange={(event) => setSourceTitle(event.target.value)}
                placeholder="What the source is about"
                className="min-h-11 rounded-xl border border-edge bg-ink/55 px-3 text-sm text-bone outline-none placeholder:text-muted/65 focus:border-sky/60"
              />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Source or author label
              <input
                value={sourceLabel}
                onChange={(event) => setSourceLabel(event.target.value)}
                placeholder="For example, Supersonik field observation"
                className="min-h-11 rounded-xl border border-edge bg-ink/55 px-3 text-sm text-bone outline-none placeholder:text-muted/65 focus:border-sky/60"
              />
            </label>
          </div>
          <label className="mt-3 grid gap-1 text-xs text-muted">
            Source link
            <input
              type="url"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="Optional http or https link"
              className="min-h-11 rounded-xl border border-edge bg-ink/55 px-3 text-sm text-bone outline-none placeholder:text-muted/65 focus:border-sky/60"
            />
          </label>
          <label className="mt-3 grid gap-1 text-xs text-muted">
            Source material
            <textarea
              value={sourceContent}
              onChange={(event) => setSourceContent(event.target.value)}
              rows={8}
              placeholder="Paste the post, article excerpt or your notes"
              className="rounded-xl border border-edge bg-ink/55 px-3 py-3 text-sm leading-6 text-bone outline-none placeholder:text-muted/65 focus:border-sky/60"
            />
          </label>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted">
              One Terra extraction. The draft remains private until an owner or manager publishes it.
            </p>
            <button
              type="button"
              onClick={() => void buildFieldNote()}
              disabled={fieldNoteBusy || sourceContent.trim().length < 120}
              className="min-h-11 rounded-full border border-sky/60 bg-sky/15 px-5 font-mono text-[0.58rem] uppercase text-sky hover:bg-sky/25 disabled:opacity-35"
            >
              {fieldNoteBusy ? "Building private draft…" : "Build private lesson"}
            </button>
          </div>
        </section>
      ) : null}

      {loading ? <MatrixRain size="panel" messages={["loading sales knowledge", "organising approved lessons"]} /> : null}
      {error ? <p className="rounded-xl border border-rust/40 bg-rust/10 p-4 text-sm text-rust">{error}</p> : null}
      {buildNote ? <p role="status" className="mb-4 rounded-xl border border-amber/35 bg-amber/[0.06] p-3 text-sm text-amber">{buildNote}</p> : null}
      {!loading && !error && reviewQueue.length > 0 ? (
        <section className="mb-6 rounded-2xl border border-amber/40 bg-amber/[0.04] p-4 sm:p-5 print:hidden">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-amber">Call lesson review queue</p>
              <h2 className="mt-1 font-display text-xl text-bone">Choose the calls worth teaching from</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
                This shortlist uses saved CRM facts and transcript size, so reviewing it costs no AI tokens. Internal, interview, support and weak calls are excluded.
              </p>
            </div>
            <div className="shrink-0 rounded-lg border border-edge bg-ink/35 px-3 py-2 text-right">
              <p className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">Eligible calls</p>
              <p className="font-display text-xl text-amber">{reviewQueue.length}</p>
            </div>
          </div>

          <div className="mt-4 space-y-2.5">
            {visibleQueue.map((call) => {
              const checked = selected.has(call.id);
              const confidence = call.score >= 75 ? "strong" : call.score >= 58 ? "good" : "possible";
              return (
                <div key={call.id} className={`rounded-xl border p-3.5 transition ${checked ? "border-amber bg-amber/[0.07]" : "border-edge bg-panel/45"}`}>
                  <div className="flex items-start gap-3">
                    <button type="button" onClick={() => toggleSelected(call.id)} aria-pressed={checked} className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border font-mono text-sm ${checked ? "border-amber bg-amber text-ink" : "border-edge text-muted hover:border-amber/60 hover:text-amber"}`}>
                      {checked ? "✓" : ""}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <Link href={`/crm/calls/${call.id}`} className="inline-flex min-h-10 items-center rounded-md font-display text-[1.05rem] text-bone transition hover:text-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/70">
                            {call.company || call.candidate || "Unnamed call"}
                          </Link>
                          <p className="text-[0.76rem] text-muted">
                            {[call.candidate && call.candidate !== call.company ? call.candidate : "", call.role].filter(Boolean).join(" · ") || "Recorded sales conversation"}
                          </p>
                        </div>
                        <span className={`w-fit rounded-full border px-2.5 py-1 font-mono text-[0.52rem] uppercase ${call.score >= 75 ? "border-sage/50 bg-sage/10 text-sage" : "border-amber/50 bg-amber/10 text-amber"}`}>
                          {call.score}/100 · {confidence}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {call.reasons.map((reason) => <span key={reason} className="rounded-full border border-edge bg-ink/40 px-2 py-1 text-[0.66rem] text-bone/70">{reason}</span>)}
                      </div>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="font-mono text-[0.55rem] uppercase tracking-wider text-muted">
                          {new Date(call.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · {formatDuration(call.durationSeconds)} · ~{Math.round(call.transcriptChars / 5.5).toLocaleString()} words
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <select aria-label="Playbook lesson type" value={modes[call.id] || call.suggestedMode} onChange={(event) => setModes((current) => ({ ...current, [call.id]: event.target.value as "prospect_demo" | "commercial_partner" }))} className="min-h-10 rounded-lg border border-edge bg-ink/60 px-3 font-mono text-[0.56rem] uppercase text-bone outline-none focus:border-amber/60">
                            <option value="prospect_demo">Prospect or demo</option>
                            <option value="commercial_partner">Commercial partner</option>
                          </select>
                          <Link href={`/crm/calls/${call.id}`} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-edge px-3 font-mono text-[0.56rem] uppercase text-sky hover:border-sky/50">Review call</Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-edge/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[0.76rem] leading-snug text-muted">Selecting is free. Building uses one Terra extraction per approved call and never contacts the client.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => { setQueuePage((page) => Math.max(0, page - 1)); setSelected(new Set()); }} disabled={queuePage === 0 || building} className="min-h-10 rounded-full border border-edge px-3 font-mono text-[0.56rem] uppercase text-muted disabled:opacity-30">Previous five</button>
              <button type="button" onClick={() => { setQueuePage((page) => page + 1); setSelected(new Set()); }} disabled={(queuePage + 1) * 5 >= reviewQueue.length || building} className="min-h-10 rounded-full border border-edge px-3 font-mono text-[0.56rem] uppercase text-muted disabled:opacity-30">Next five</button>
              <button type="button" onClick={buildSelected} disabled={!selected.size || building} className="min-h-10 rounded-full border border-amber/60 bg-amber/15 px-4 font-mono text-[0.58rem] uppercase text-amber hover:bg-amber/25 disabled:opacity-35">
                {building ? "Building lessons…" : `Build ${selected.size || "selected"} ${selected.size === 1 ? "lesson" : "lessons"}`}
              </button>
            </div>
          </div>
        </section>
      ) : null}
      {!loading && !error && chapters.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-edge bg-panel/30 p-6">
          <h2 className="font-display text-xl text-bone">No sales knowledge lessons yet</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            An owner or manager can add a field lesson. You can also open a useful prospect or demo call and approve it as a lesson. Internal and routine partner calls remain excluded.
          </p>
          <Link href="/crm/calls" className="mt-4 inline-flex rounded-full border border-amber/50 bg-amber/10 px-4 py-2 font-mono text-[0.6rem] uppercase text-amber">
            Open calls
          </Link>
        </section>
      ) : null}

      {!loading && !error && chapters.length > 0 ? (
        <section className="mb-5 rounded-2xl border border-edge bg-panel/40 p-4 print:hidden">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <label className="block flex-1">
              <span className="mb-1.5 block font-mono text-[0.56rem] uppercase tracking-[0.17em] text-sage">Search sales knowledge</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Try: high volume, admissions, objections, training…"
                className="min-h-11 w-full rounded-xl border border-edge bg-ink/55 px-3 text-sm text-bone outline-none placeholder:text-muted/65 focus:border-amber/60"
              />
            </label>
            <div className="shrink-0 font-mono text-[0.58rem] uppercase tracking-wider text-muted">
              {filteredChapters.length} of {chapters.length} saved lessons
            </div>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">Searches saved lessons locally and uses no AI tokens. The Brain retrieves up to three approved relevant lessons for sales questions and sales call preparation.</p>
        </section>
      ) : null}

      {!loading && !error && chapters.length > 0 && filteredChapters.length === 0 ? (
        <section className="mb-5 rounded-2xl border border-dashed border-edge bg-panel/25 p-5 text-sm text-muted">
          No saved lesson matches “{search}”. Try a company, buyer problem, objection or sales question.
        </section>
      ) : null}

      <div className="space-y-5">
        {filteredChapters.map((chapter) => {
          const chapterIndex = chapters.findIndex((item) => item.id === chapter.id);
          const fieldLesson = chapter.sourceKind === "field_note" || chapter.kind === "field_note";
          const publishedToTeam = chapter.status === "approved" && chapter.visibility === "team";
          return (
          <article id={`lesson-${chapter.id}`} key={chapter.id} className={`scroll-mt-6 break-inside-avoid rounded-2xl border bg-panel/45 p-4 sm:p-6 ${chapter.status === "draft" ? "border-sky/55" : "border-edge"}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-sage">
                  <span>Lesson {chapters.length - chapterIndex}</span>
                  <span>·</span>
                  <span>{fieldLesson ? "field lesson" : chapter.mode === "commercial_partner" ? "commercial partner" : "prospect or demo"}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[0.48rem] ${publishedToTeam ? "border-sage/50 bg-sage/10 text-sage" : chapter.status === "draft" ? "border-sky/50 bg-sky/10 text-sky" : "border-edge text-muted"}`}>
                    {publishedToTeam ? "team approved" : chapter.status === "draft" ? "private draft" : "private"}
                  </span>
                </div>
                <h2 className="mt-1 font-display text-xl text-bone">{chapter.title}</h2>
                {chapter.audience ? <p className="mt-1 text-sm text-muted">Useful with {chapter.audience}</p> : null}
                {chapter.sourceLabel ? <p className="mt-1 text-xs text-muted">Source {chapter.sourceLabel}</p> : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">
                {chapter.canEdit && canManageTeamKnowledge ? (
                  <button
                    type="button"
                    onClick={() => void changeKnowledgeAccess(chapter, publishedToTeam ? "make_private" : "publish_team")}
                    disabled={!!knowledgeBusy}
                    className="min-h-9 rounded-full border border-sage/50 bg-sage/10 px-3 font-mono text-[0.55rem] uppercase text-sage hover:bg-sage/20 disabled:opacity-35"
                  >
                    {knowledgeBusy === chapter.id ? "Saving…" : publishedToTeam ? "Make private" : "Publish to team"}
                  </button>
                ) : null}
                <button type="button" onClick={() => downloadPdf([chapter], chapter.id, "Interviewa sales knowledge lesson")} disabled={!!downloading} className="min-h-9 rounded-full border border-edge px-3 font-mono text-[0.55rem] uppercase text-amber hover:border-amber/55 disabled:opacity-35">
                  {downloading === chapter.id ? "Building PDF…" : "Download lesson"}
                </button>
                {fieldLesson && chapter.sourceUrl?.startsWith("http") ? (
                  <a href={chapter.sourceUrl} target="_blank" rel="noreferrer" className="font-mono text-[0.58rem] uppercase text-sky hover:text-amber">
                    Source ↗
                  </a>
                ) : null}
                {chapter.callId ? (
                  <Link href={`/crm/calls/${chapter.callId}`} className="font-mono text-[0.58rem] uppercase text-sky hover:text-amber">
                    Source call ↗
                  </Link>
                ) : null}
              </div>
            </div>

            {chapter.sourceSummary ? (
              <div className="mt-4 rounded-xl border border-sky/30 bg-sky/[0.05] p-3 text-sm leading-6 text-bone/85">
                <span className="font-mono text-[0.56rem] uppercase tracking-[0.16em] text-sky">Source insight</span>
                <p className="mt-1">{chapter.sourceSummary}</p>
              </div>
            ) : null}

            {chapter.principle ? (
              <div className="mt-4 rounded-xl border border-amber/40 bg-amber/[0.06] p-4 text-sm leading-6 text-bone">
                <span className="font-mono text-[0.56rem] uppercase tracking-[0.16em] text-amber">Operating principle</span>
                <p className="mt-1 font-medium">{chapter.principle}</p>
              </div>
            ) : null}

            {chapter.liveCoachSafeguard ? (
              <div className="mt-3 rounded-xl border border-rust/30 bg-rust/[0.05] p-3 text-sm leading-6 text-bone/85">
                <span className="font-mono text-[0.56rem] uppercase tracking-[0.16em] text-rust">LiveCoach safeguard</span>
                <p className="mt-1">{chapter.liveCoachSafeguard}</p>
              </div>
            ) : null}

            {chapter.scenario ? (
              <div className="mt-4 rounded-xl border border-sage/30 bg-sage/[0.06] p-3 text-sm leading-6 text-bone/85">
                <span className="font-mono text-[0.56rem] uppercase tracking-[0.16em] text-sage">When to use this</span>
                <p className="mt-1">{chapter.scenario}</p>
              </div>
            ) : null}

            {chapter.calibrationLevels?.length ? (
              <div className="mt-4">
                <p className="mb-2 font-mono text-[0.56rem] uppercase tracking-[0.17em] text-muted">Calibration guide</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {chapter.calibrationLevels.map((item, index) => (
                    <div key={`${item.level}:${index}`} className="rounded-xl border border-edge bg-ink/35 p-3">
                      <h3 className="text-sm font-medium text-bone">{item.level}</h3>
                      <ul className="mt-2 space-y-1 text-[0.78rem] leading-snug text-muted">
                        {safeList(item.signals).map((signal) => <li key={signal}>• {signal}</li>)}
                      </ul>
                      <p className="mt-2 text-[0.78rem] leading-snug text-sage">Adapt by {item.sellerMove}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <List title={fieldLesson ? "Diagnostic questions" : "Seller questions that worked"} items={fieldLesson ? safeList(chapter.diagnosticQuestions) : safeList(chapter.questionsThatWorked)} />
              <List title={fieldLesson ? "Evidence of real use" : "Buyer language"} items={fieldLesson ? safeList(chapter.buyingSignals) : safeList(chapter.buyerLanguage)} tone="text-sky/90" />
              <List title="Pitch moves" items={safeList(chapter.pitchMoves)} tone="text-sage/90" />
              {!fieldLesson ? <List title="Buying signals" items={safeList(chapter.buyingSignals)} tone="text-amber/90" /> : null}
            </div>

            {Array.isArray(chapter.objections) && chapter.objections.length ? (
              <div className="mt-4">
                <p className="mb-2 font-mono text-[0.56rem] uppercase tracking-[0.17em] text-muted">{fieldLesson ? "Claim or behaviour and response" : "Objections and response"}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {chapter.objections.map((item, index) => (
                    <div key={index} className="rounded-lg border border-edge bg-ink/35 p-3 text-[0.8rem] leading-snug">
                      <p className="text-rust">{item.signal}</p>
                      <p className="mt-1 text-bone/80">Then: {item.response}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 rounded-xl border border-amber/35 bg-amber/[0.05] p-4">
              <p className="font-mono text-[0.56rem] uppercase tracking-[0.17em] text-amber">Reusable conversation path</p>
              <ol className="mt-2 space-y-2">
                {safeList(chapter.script).map((line, index) => (
                  <li key={index} className="flex gap-3 text-sm leading-6 text-bone/85">
                    <span className="font-mono text-amber/70">{index + 1}</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="mt-4"><List title={fieldLesson ? "Avoid" : "Avoid next time"} items={safeList(chapter.avoid)} tone="text-rust/85" /></div>
            {chapter.knowledgeChecks?.length ? (
              <div className="mt-4 rounded-xl border border-edge bg-ink/30 p-4">
                <p className="font-mono text-[0.56rem] uppercase tracking-[0.17em] text-sky">Knowledge check</p>
                <div className="mt-2 space-y-2">
                  {chapter.knowledgeChecks.map((item, index) => (
                    <details key={`${item.question}:${index}`} className="rounded-lg border border-edge bg-panel/45 px-3 py-2 text-sm">
                      <summary className="cursor-pointer text-bone">{item.question}</summary>
                      <p className="mt-2 leading-6 text-muted">{item.answer}</p>
                    </details>
                  ))}
                </div>
              </div>
            ) : null}
          </article>
        );})}
      </div>
    </main>
  );
}
