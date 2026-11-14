import "server-only";

import { NextResponse } from "next/server";

import { requireInterviewerOwner, interviewerOwnerError } from "@/lib/interviewer/access";
import { llmUsd, loadCostRates, recordCostEvent } from "@/lib/interviewer/cost-store";
import { interviewerFieldError } from "@/lib/interviewer/field-error";
import { clipHeadline, formatDeckKnowledge, headlineFromNotes, isGenericSlideTitle } from "@/lib/interviewer/slide-headline";
import { isInternalCostLine } from "@/lib/interviewer/slide-notes";
import { headlinesFromContent, notesFromImages } from "@/lib/interviewer/slide-vision";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "private, no-store" };
const UUID = /^[0-9a-f-]{36}$/i;

function mimeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

async function signUploads(rows: Array<{ slide_number: number; image_path: string }>) {
  const uploads = [];
  for (const row of rows) {
    const contentType = mimeFor(row.image_path);
    const signed = await supabaseService.storage.from("interviewer-slides").createSignedUploadUrl(row.image_path, { upsert: true });
    if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error("The slide upload could not be signed.");
    uploads.push({
      slideNumber: row.slide_number,
      path: row.image_path,
      signedUrl: signed.data.signedUrl,
      contentType,
    });
  }
  return uploads;
}

export async function GET(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const campaignId = new URL(req.url).searchParams.get("campaignId") || "";
    if (!UUID.test(campaignId)) return NextResponse.json({ decks: [] }, { headers: noStore });
    const decks = await supabaseService
      .from("interviewer_decks")
      .select("id, title, created_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false });
    if (decks.error) return NextResponse.json({ decks: [], ready: false }, { headers: noStore });
    const slides = await supabaseService
      .from("interviewer_slides")
      .select("deck_id, slide_number, title, image_path")
      .eq("workspace_id", scope.workspaceId)
      .eq("campaign_id", campaignId)
      .order("slide_number", { ascending: true });
    if (slides.error) return NextResponse.json({ decks: [], ready: false }, { headers: noStore });
    const grouped = [];
    const ordered = decks.data || [];
    for (const [index, deck] of ordered.entries()) {
      const deckSlides = (slides.data || []).filter((item) => item.deck_id === deck.id);
      const folder = deckSlides[0]?.image_path?.split("/").slice(0, -1).join("/") || "";
      const listed = folder
        ? await supabaseService.storage.from("interviewer-slides").list(folder, { limit: 100 })
        : { data: [] as Array<{ name?: string }>, error: null };
      const listFailed = Boolean(listed.error);
      const names = new Set((listed.data || []).map((file) => file.name || ""));
      const pages = [];
      for (const slide of deckSlides) {
        const fileName = String(slide.image_path || "").split("/").pop() || "";
        const present = listFailed ? Boolean(slide.image_path) : Boolean(fileName) && names.has(fileName);
        let url = "";
        if (present) {
          const signed = await supabaseService.storage.from("interviewer-slides").createSignedUrl(slide.image_path, 600);
          url = signed.data?.signedUrl || "";
        }
        pages.push({
          number: slide.slide_number,
          title: slide.title,
          url,
          missing: !present,
        });
      }
      grouped.push({
        id: deck.id,
        title: deck.title,
        active: index === 0,
        imagesMissing: pages.length > 0 && pages.every((page) => page.missing),
        slides: index === 0 ? pages : [],
      });
    }
    return NextResponse.json({ decks: grouped, ready: true }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}

export async function POST(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const body = await req.json().catch(() => null);
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const action = String(record.action || "");

    if (action === "prepare") {
      const campaignId = String(record.campaignId || "");
      const pageCount = Number(record.pageCount);
      if (!UUID.test(campaignId)) {
        return interviewerFieldError("interviewer_deck_blocked", "Deck was not saved", { campaignId: "Pick a campaign." });
      }
      if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 40) {
        return interviewerFieldError("interviewer_deck_blocked", "Deck was not saved", { file: "A deck can have from 1 to 40 pages." });
      }
      const owned = await supabaseAdmin.from("interviewer_campaigns").select("id").eq("id", campaignId).eq("workspace_id", scope.workspaceId).maybeSingle();
      if (owned.error) throw owned.error;
      if (!owned.data) return interviewerFieldError("interviewer_deck_blocked", "Deck was not saved", { campaignId: "That campaign is not on your account." });
      const existing = await supabaseService.from("interviewer_decks").select("id").eq("campaign_id", campaignId).eq("workspace_id", scope.workspaceId).limit(1);
      if (existing.error) throw existing.error;
      if ((existing.data || []).length && record.replace !== true) {
        return interviewerFieldError("interviewer_deck_blocked", "Deck was not saved", {
          file: "This campaign already has a deck. Confirm that you want to replace it.",
        });
      }
      if (record.replace === true) {
        const removed = await supabaseService.from("interviewer_decks").delete().eq("campaign_id", campaignId).eq("workspace_id", scope.workspaceId);
        if (removed.error) throw removed.error;
      }
      const deckId = crypto.randomUUID();
      const rows = Array.from({ length: pageCount }, (_, index) => {
        const number = index + 1;
        return {
          workspace_id: scope.workspaceId,
          campaign_id: campaignId,
          deck_id: deckId,
          slide_number: number,
          image_path: `${scope.workspaceId}/${campaignId}/${deckId}/${number}.png`,
          image_mime: "image/png",
          title: `Slide ${number}`,
          one_line: "",
          talking_points: "",
        };
      });
      const deck = await supabaseService.from("interviewer_decks").insert({
        id: deckId,
        workspace_id: scope.workspaceId,
        campaign_id: campaignId,
        title: String(record.fileName || "Deck").replace(/\.pdf$/i, "").slice(0, 160) || "Deck",
        outline: "",
      });
      if (deck.error) throw deck.error;
      const inserted = await supabaseService.from("interviewer_slides").insert(rows);
      if (inserted.error) throw inserted.error;
      const uploads = await signUploads(rows);
      return NextResponse.json({ deckId, uploads }, { headers: noStore });
    }

    if (action === "replace") {
      const deckId = String(record.deckId || "");
      const pageCount = Number(record.pageCount);
      if (!UUID.test(deckId)) return interviewerFieldError("interviewer_deck_blocked", "Images were not replaced", { file: "Choose a deck." });
      const deck = await supabaseService.from("interviewer_decks").select("id").eq("id", deckId).eq("workspace_id", scope.workspaceId).maybeSingle();
      if (deck.error) throw deck.error;
      if (!deck.data) return interviewerFieldError("interviewer_deck_blocked", "Images were not replaced", { file: "That deck is not on your account." });
      const slides = await supabaseService
        .from("interviewer_slides")
        .select("slide_number, image_path")
        .eq("deck_id", deckId)
        .eq("workspace_id", scope.workspaceId)
        .order("slide_number", { ascending: true });
      if (slides.error) throw slides.error;
      const rows = slides.data || [];
      if (!rows.length) return interviewerFieldError("interviewer_deck_blocked", "Images were not replaced", { file: "That deck has no slide rows." });
      if (pageCount !== rows.length) {
        return interviewerFieldError("interviewer_deck_blocked", "Images were not replaced", {
          file: `This deck has ${rows.length} slides. The PDF has ${pageCount} pages. Use a PDF with one page for each existing slide.`,
        });
      }
      const uploads = await signUploads(rows);
      return NextResponse.json({ deckId, uploads }, { headers: noStore });
    }

    if (action === "notes" || action === "rebuild") {
      const deckId = String(record.deckId || "");
      if (!UUID.test(deckId)) return interviewerFieldError("interviewer_deck_blocked", "Slide notes were not saved", { file: "Choose a deck." });
      const deck = await supabaseService.from("interviewer_decks").select("id, campaign_id").eq("id", deckId).eq("workspace_id", scope.workspaceId).maybeSingle();
      if (deck.error) throw deck.error;
      if (!deck.data) return interviewerFieldError("interviewer_deck_blocked", "Slide notes were not saved", { file: "That deck is not on your account." });
      const slides = await supabaseService
        .from("interviewer_slides")
        .select("id, slide_number, image_path")
        .eq("deck_id", deckId)
        .order("slide_number", { ascending: true });
      if (slides.error) throw slides.error;
      const images = [];
      const missing: number[] = [];
      for (const slide of slides.data || []) {
        const file = await supabaseService.storage.from("interviewer-slides").download(slide.image_path);
        if (file.error || !file.data) {
          missing.push(slide.slide_number);
          continue;
        }
        images.push({
          number: slide.slide_number,
          bytes: new Uint8Array(await file.data.arrayBuffer()),
          mime: mimeFor(slide.image_path),
        });
      }
      if (!images.length) {
        return NextResponse.json({ updated: 0, missing, note: "The slide images are not in storage yet." }, { headers: noStore });
      }
      const pitch = await notesFromImages(images);
      for (const note of pitch.slides) {
        const row = (slides.data || []).find((slide) => slide.slide_number === note.number);
        if (!row) continue;
        await supabaseService.from("interviewer_slides").update({
          title: note.title,
          one_line: note.oneLine,
          talking_points: note.talkingPoints.join("\n"),
          verbatim: note.verbatim,
          stats: note.stats,
        }).eq("id", row.id);
      }
      const outline = formatDeckKnowledge(pitch.slides.map((slide) => ({
        number: slide.number,
        title: slide.title,
        facts: slide.talkingPoints,
        prices: slide.stats,
      })));
      await supabaseService.from("interviewer_decks").update({ outline }).eq("id", deckId);
      const warnings = [pitch.slides.map((slide) => slide.stats).join(" ")].filter((line) => isInternalCostLine(line));
      const rates = await loadCostRates();
      if (rates) {
        await recordCostEvent({
          workspaceId: scope.workspaceId,
          campaignId: deck.data.campaign_id,
          kind: "deck_vision",
          usd: llmUsd(rates, pitch.inputTokens, pitch.outputTokens),
          detail: { slides: images.length, inputTokens: pitch.inputTokens, outputTokens: pitch.outputTokens },
        });
      }
      return NextResponse.json({ updated: pitch.slides.length, missing, warnings }, { headers: noStore });
    }

    if (action === "rename") {
      const deckId = String(record.deckId || "");
      const slideNumber = Number(record.slideNumber);
      const title = clipHeadline(String(record.title || ""));
      if (!UUID.test(deckId) || !Number.isInteger(slideNumber)) {
        return interviewerFieldError("interviewer_deck_blocked", "Headline was not saved", { file: "Choose a slide." });
      }
      if (!title || isGenericSlideTitle(title)) {
        return interviewerFieldError("interviewer_deck_blocked", "Headline was not saved", { file: "Add a headline of up to 60 characters." });
      }
      if (isInternalCostLine(title)) {
        return interviewerFieldError("interviewer_deck_blocked", "Headline was not saved", { file: "That headline mentions an internal cost." });
      }
      const updated = await supabaseService
        .from("interviewer_slides")
        .update({ title })
        .eq("deck_id", deckId)
        .eq("workspace_id", scope.workspaceId)
        .eq("slide_number", slideNumber)
        .select("slide_number, title")
        .maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data) return interviewerFieldError("interviewer_deck_blocked", "Headline was not saved", { file: "That slide is not on your account." });
      return NextResponse.json({ title: updated.data.title, slideNumber: updated.data.slide_number }, { headers: noStore });
    }

    if (action === "headlines") {
      const deckId = String(record.deckId || "");
      if (!UUID.test(deckId)) return interviewerFieldError("interviewer_deck_blocked", "Headlines were not written", { file: "Choose a deck." });
      const deck = await supabaseService.from("interviewer_decks").select("id, title, campaign_id").eq("id", deckId).eq("workspace_id", scope.workspaceId).maybeSingle();
      if (deck.error) throw deck.error;
      if (!deck.data) return interviewerFieldError("interviewer_deck_blocked", "Headlines were not written", { file: "That deck is not on your account." });
      const slides = await supabaseService
        .from("interviewer_slides")
        .select("id, slide_number, title, one_line, talking_points, verbatim, image_path")
        .eq("deck_id", deckId)
        .order("slide_number", { ascending: true });
      if (slides.error) throw slides.error;
      const generic = (slides.data || []).filter((slide) => isGenericSlideTitle(String(slide.title || ""), String(deck.data?.title || "")));
      const written: Array<{ number: number; title: string }> = [];
      const fromText = generic.flatMap((slide) => {
        const text = [slide.talking_points, slide.one_line, slide.verbatim].filter(Boolean).join("\n").trim();
        return text ? [{ number: slide.slide_number, text: text.slice(0, 1200), id: slide.id }] : [];
      });
      const modelTitles = await headlinesFromContent(fromText.map((slide) => ({ number: slide.number, text: slide.text })));
      for (const slide of fromText) {
        const title = modelTitles.get(slide.number) || headlineFromNotes({ talkingPoints: slide.text });
        if (!title) continue;
        await supabaseService.from("interviewer_slides").update({ title }).eq("id", slide.id);
        written.push({ number: slide.number, title });
      }
      const unread = generic.filter((slide) => !fromText.some((item) => item.number === slide.slide_number));
      const images = [];
      for (const slide of unread) {
        if (!slide.image_path) continue;
        const file = await supabaseService.storage.from("interviewer-slides").download(slide.image_path);
        if (file.error || !file.data) continue;
        images.push({ number: slide.slide_number, id: slide.id, bytes: new Uint8Array(await file.data.arrayBuffer()), mime: mimeFor(slide.image_path) });
      }
      if (images.length) {
        const pitch = await notesFromImages(images.map((image) => ({ number: image.number, bytes: image.bytes, mime: image.mime })));
        for (const note of pitch.slides) {
          const row = images.find((image) => image.number === note.number);
          if (!row || !note.title) continue;
          await supabaseService.from("interviewer_slides").update({
            title: note.title,
            one_line: note.oneLine,
            talking_points: note.talkingPoints.join("\n"),
            verbatim: note.verbatim,
          }).eq("id", row.id);
          written.push({ number: note.number, title: note.title });
        }
      }
      const skipped = generic.length - written.length;
      return NextResponse.json({
        updated: written.length,
        skipped,
        headlines: written,
        note: skipped ? "Some slides had no text or image to read." : "",
      }, { headers: noStore });
    }

    return interviewerFieldError("interviewer_deck_blocked", "Deck was not saved", { file: "Choose a PDF. The pages are rendered in the browser." });
  } catch (error) {
    if (error instanceof Error && error.message === "not_configured") {
      return interviewerFieldError("interviewer_deck_blocked", "Slide notes were not saved", { file: "The writing service is not configured. The images can still be uploaded." });
    }
    return interviewerOwnerError(error);
  }
}
