# LiveCoach — live whisper

A real-time interview coaching POC. It listens to a live interview, transcribes
it, and whispers the **next best question** to ask — every 5 seconds, synced to
the conversation rather than waiting for a pause. Pulls from the candidate's CV,
your previous interview summary, and a question framework.

Built for a **GitHub → Vercel** workflow. No local dev needed.

---

## Stack

| Layer          | Tool                                   |
| -------------- | -------------------------------------- |
| Frontend / API | Next.js 14 (App Router) on Vercel      |
| Transcription  | Deepgram (live, browser → WebSocket)   |
| Suggestions    | Claude **Haiku 4.5** (live tier)       |
| Store          | Supabase (text chunks; no vectors yet) |

---

## Cost model — read this

Target was £3/hr. This POC lands **well under** it, but only because of two
deliberate choices. Continuous 5s suggestions = ~720 Claude calls/hour, so the
model and how context is sent matter enormously.

**Per-hour running cost (1 active user, continuous 5s):**

| Component                    | Cost/hr (≈) |
| ---------------------------- | ----------- |
| Deepgram streaming           | £0.36       |
| Claude Haiku + prompt cache  | £0.68       |
| Vercel compute (est.)        | £0.16       |
| Supabase reads (est.)        | £0.02       |
| **Total**                    | **≈ £1.22** |

Two levers keep it there:

1. **Live track runs on Haiku 4.5, not Sonnet.** Sonnet at this cadence is
   ~£4/hr — over the ceiling. Haiku is the cheap/fast/reactive live tier;
   Sonnet/Opus + extended thinking every ~30s is the **pro upsell**, not the default.
2. **Knowledge is loaded once and cached.** `/api/interview/context` pulls the
   candidate's CV + framework at session start; `/api/interview/suggest` pins it
   in a cached system block, so each 5s call only pays full price for the new
   transcript — not the whole knowledge base 720 times.

The app shows a **live cost meter** and an **end-of-session breakdown**. The
meter turns red if the pace crosses £3/hr. These are estimates from
`lib/costs.ts` — edit the rates there if pricing moves.

> Scaling note (CTO flag): cost is per active concurrent user. 100 simultaneous
> interviews ≈ £122/hr. Fine for a POC; the lever at scale is interval length
> and prompt caching, both already in place.

---

## Setup (one-time, ~8 min)

### 1. Supabase
1. Create a project at supabase.com.
2. Open **SQL Editor**, run all of `supabase/schema.sql`.
3. From **Project Settings → API**, grab:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

### 2. API keys
- **Anthropic**: console.anthropic.com → `ANTHROPIC_API_KEY`
- **Deepgram**: console.deepgram.com → `DEEPGRAM_API_KEY`
- *(Voyage is NOT needed for the POC — only if you re-enable vector search.)*

### 3. Push & deploy
1. Push to GitHub, import into Vercel.
2. Vercel → **Settings → Environment Variables** → add everything from
   `.env.example` (real values). **Redeploy.**

---

## Using it
1. Enter **candidate name** + **role**.
2. Upload docs in the **Knowledge base** panel (CV / previous summary scoped to
   the candidate; framework is global). Upload `sample-question-framework.txt`
   to start.
3. **Start session**, allow the mic, talk. Cues stream in every 5s. **Suggest
   now** forces one. **End session** shows the cost breakdown.

---

## Two things to verify on first run
1. **Model strings** — `lib/anthropic.ts` reads `CLAUDE_MODEL_LIVE`
   (default `claude-haiku-4-5`). 404? Set the exact string in Vercel env.
2. **Deepgram auth** — browser connects via WebSocket subprotocol
   `["token", access_token]`. 401 on connect? Flip `"token"` → `"bearer"` in
   `components/InterviewConsole.tsx`.

---

## Built to extend (the multi-template vision)
The only real difference between interview / sales / support is the **system
prompt** + **which docs load**. To add a mode:
- add a `mode` field at session start,
- branch the instructions in `app/api/interview/suggest/route.ts`,
- scope `/context` to that mode's docs.

The **pro tier** is a second parallel call: Sonnet/Opus + extended thinking,
batched every ~30s, doing anticipatory analysis (predict the next objection /
flag strong-vs-weak answers) alongside the cheap live cues. Cost impact: roughly
+£2–3/hr on top of the live track, hence pro-only.

When knowledge bases get large (sales with many brochures), switch the live loop
back to **vector search**: uncomment the vector section in `schema.sql`, set
`VOYAGE_API_KEY`, and re-enable embeddings in the upload route using
`lib/embeddings.ts` (kept in the repo for exactly this).

---

## File map
```
app/
  layout.tsx                       fonts + shell
  page.tsx                         renders the console
  globals.css                      theme
  api/
    deepgram/token/route.ts        mints short-lived Deepgram token
    knowledge/upload/route.ts      extract → chunk → store (text only)
    interview/context/route.ts     loads CV+framework ONCE per session
    interview/suggest/route.ts     cached knowledge + Haiku → streamed cue
components/
  InterviewConsole.tsx             mic, transcript, 5s loop, cost meter
  KnowledgePanel.tsx               doc upload UI
lib/
  supabase.ts                      server client
  anthropic.ts                     Claude client + live/pro model names
  costs.ts                         cost rates + live estimator
  chunk.ts                         text chunker
  embeddings.ts                    Voyage helper (unused; for vector track)
supabase/
  schema.sql                       table (+ commented vector section)
sample-question-framework.txt      upload this as a "Question framework"
```
