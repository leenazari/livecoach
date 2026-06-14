import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 40;

const TOPICS = ["negotiation", "psychology", "strategy", "general"];

// GET /api/crm/lessons -> the whole lessons library, newest first.
export async function GET() {
  try {
    const { data } = await supabaseAdmin
      .from("lessons")
      .select("id, topic, title, content, source_url, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    return NextResponse.json({ lessons: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load lessons" },
      { status: 500 }
    );
  }
}

// POST /api/crm/lessons -> "learn from this": distill durable, reusable lessons
// from pasted content (a transcript, an article) under a topic, and store them.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let content = typeof body.content === "string" ? body.content.trim() : "";
    const topic = TOPICS.includes(body.topic) ? body.topic : "general";
    const youtubeUrl =
      typeof body.youtubeUrl === "string" && body.youtubeUrl.trim()
        ? body.youtubeUrl.trim()
        : "";
    let sourceUrl =
      typeof body.sourceUrl === "string" && body.sourceUrl.trim()
        ? body.sourceUrl.trim()
        : youtubeUrl || null;

    // If a YouTube link is given and no transcript was pasted, fetch the
    // transcript via Supadata (server-to-server, so YouTube's bot-block on
    // datacenter IPs doesn't apply). Needs SUPADATA_API_KEY in the env.
    if (!content && youtubeUrl) {
      const key = process.env.SUPADATA_API_KEY;
      if (!key) {
        return NextResponse.json(
          {
            error:
              "YouTube fetching isn't set up yet - add a SUPADATA_API_KEY env var, or paste the transcript instead.",
          },
          { status: 400 }
        );
      }
      try {
        const r = await fetch(
          `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(
            youtubeUrl
          )}`,
          { headers: { "x-api-key": key } }
        );
        const d = await r.json();
        if (!r.ok) {
          return NextResponse.json(
            { error: `couldn't fetch that video (${d?.error || r.status})` },
            { status: 502 }
          );
        }
        const segs = Array.isArray(d?.content) ? d.content : [];
        content = segs
          .map((s: any) => (typeof s?.text === "string" ? s.text : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        sourceUrl = youtubeUrl;
      } catch (e: any) {
        return NextResponse.json(
          { error: "couldn't reach the transcript service - try again" },
          { status: 502 }
        );
      }
    }

    if (content.length < 80) {
      return NextResponse.json(
        { error: "not enough transcript/content to learn from" },
        { status: 422 }
      );
    }

    const system = `You distil DURABLE, REUSABLE lessons from a piece of content (a video transcript, article or notes) for a sales/relationship operator to apply on real calls. Focus on the topic: ${topic}.

Output ONLY JSON: { "title": "a short source title", "lessons": [ "a crisp, actionable principle in one or two sentences", ... ] }

Rules:
- 3-8 lessons. Each is a transferable principle the user can apply with any client, not a summary of the content's specifics.
- Plain English. No markdown, no numbering, no em-dashes or semicolons.
- Only lessons genuinely supported by the content. If it is thin, return fewer.`;

    let title = sourceUrl || `${topic} notes`;
    let lessons: string[] = [];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 32000);
      try {
        const msg = await anthropic.messages.create(
          {
            model: CLAUDE_MODEL_PRO,
            max_tokens: 900,
            temperature: 0.3,
            system,
            messages: [
              { role: "user", content: content.slice(0, 16000) },
            ],
          },
          { signal: controller.signal }
        );
        const raw = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("")
          .replace(/```json|```/g, "")
          .trim();
        const a = raw.indexOf("{");
        const b = raw.lastIndexOf("}");
        const parsed = a >= 0 && b > a ? JSON.parse(raw.slice(a, b + 1)) : null;
        if (parsed) {
          if (typeof parsed.title === "string" && parsed.title.trim())
            title = parsed.title.trim();
          if (Array.isArray(parsed.lessons))
            lessons = parsed.lessons
              .filter((l: any) => typeof l === "string" && l.trim())
              .map((l: string) => l.trim())
              .slice(0, 8);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return NextResponse.json(
        { error: "couldn't distil that just now - try again" },
        { status: 504 }
      );
    }

    if (lessons.length === 0) {
      return NextResponse.json(
        { error: "no clear lessons found in that content" },
        { status: 422 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("lessons")
      .insert({
        topic,
        title,
        content: lessons.map((l) => `- ${l}`).join("\n"),
        source_url: sourceUrl,
      })
      .select("id, topic, title, content, source_url, created_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ lesson: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to save lesson" },
      { status: 500 }
    );
  }
}
