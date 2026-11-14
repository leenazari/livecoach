"use client";

import { useEffect, useRef, useState } from "react";

import type { CallBrief as Brief } from "@/lib/interviewer/brief";
import { toSpokenPlain } from "@/lib/interviewer/spoken-text";
import styles from "@/components/interviewer/interviewa.module.css";

type Line = { id: string; speaker: string; text: string; atSeconds?: number };
type Payload = {
  brief: Brief | null;
  hasRecording: boolean;
  durationLabel?: string;
  durationSeconds?: number;
  recordingUrl?: string;
  lines?: Line[];
  scheduledAt: string | null;
  campaignId: string;
  cost: { label: string; amount: string; estimated: boolean; voiceAgent: string; listen: string; llm: string; storage: string; vercel: string };
};

function QuestionList({ title, empty, items, seek }: { title: string; empty: string; items: Brief["questions"]; seek: (at: number) => void }) {
  return (
    <div style={{ marginTop: 12 }}>
      <p className={styles.label}>{title}</p>
      {items.length ? (
        <ol>
          {items.map((item) => (
            <li key={`${item.atSeconds}-${item.question}`}>
              <button type="button" className={styles.link} onClick={() => seek(item.atSeconds || 0)}>{formatStamp(item.atSeconds || 0)}</button>{" "}
              {item.question}
              {item.status === "unanswered" || !item.answer ? <span className={styles.red}> No answer</span> : <p className={styles.note}>{item.answer}</p>}
            </li>
          ))}
        </ol>
      ) : <p className={styles.note}>{empty}</p>}
    </div>
  );
}

function formatStamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((part) => part.slice(0, 1).toUpperCase()).join("");
}

function countdown(when: string | null): string {
  if (!when) return "";
  const delta = new Date(when).getTime() - Date.now();
  const abs = Math.abs(delta);
  const hours = Math.round(abs / 3600000);
  if (hours < 48) return delta >= 0 ? `In ${hours} hour${hours === 1 ? "" : "s"}` : `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(abs / 86400000);
  return delta >= 0 ? `In ${days} days` : `${days} days ago`;
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className={styles.headRow}><span className={styles.label} style={{ margin: 0 }}>{label}</span><span>{value}</span></div>
      <div className={styles.meter}><span style={{ width: `${value}%` }} /></div>
    </div>
  );
}

export default function CallBriefView({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [transcript, setTranscript] = useState<Line[]>([]);
  const [open, setOpen] = useState<"transcript" | "recording" | "cost" | "">("transcript");
  const [recording, setRecording] = useState("");
  const [played, setPlayed] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [actionNote, setActionNote] = useState("");

  useEffect(() => {
    fetch(`/api/crm/interviewer/calls/${sessionId}/brief`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "The brief could not be loaded.");
        setData(body);
        if (body.recordingUrl) setRecording(body.recordingUrl);
        if (body.lines) setTranscript(body.lines);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "The brief could not be loaded."));
  }, [sessionId]);

  const seek = (atSeconds: number, lead = true) => {
    const audio = audioRef.current;
    if (!audio) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : (data?.durationSeconds || 0);
    audio.currentTime = Math.max(0, Math.min(duration, atSeconds - (lead ? 2 : 0)));
    void audio.play().catch(() => undefined);
  };
  const brief = data?.brief;
  const profile = brief?.profile;
  const copy = async () => {
    if (!brief) return;
    await navigator.clipboard.writeText(brief.openingLine);
    setCopied(true);
  };
  const showTranscript = async () => {
    setOpen("transcript");
    if (transcript.length) return;
    const response = await fetch(`/api/crm/interviewer/sessions/${sessionId}`, { cache: "no-store" });
    const body = await response.json();
    setTranscript(body.utterances || []);
  };
  const showRecording = async () => {
    setOpen("recording");
    if (recording || !data?.hasRecording) return;
    const response = await fetch(`/api/crm/interviewer/sessions/${sessionId}/recording`, { cache: "no-store" });
    const body = await response.json();
    if (body.url) setRecording(body.url);
  };

  if (error) return <main className={styles.page}><p className={styles.err}>{error}</p></main>;
  if (!brief || !data) return <main className={styles.page}><p className={styles.note}>Preparing the brief…</p></main>;

  return (
    <main className={styles.page}>
      <header className={styles.headRow}>
        <div>
          <h1 className={styles.h1}>Pre-call brief: {brief.lead.name}</h1>
          <p className={styles.cardTitle}>{data.durationLabel || ""}</p>
          <p className={styles.note}>{brief.appointment.bookedBy} {data.scheduledAt ? `· ${countdown(data.scheduledAt)}` : ""}</p>
        </div>
        <a className={styles.link} href={`/crm/interviewer/campaigns/${data.campaignId}`}>Campaign</a>
      </header>

      <div className={styles.grid3} style={{ marginTop: 16 }}>
        <section className={styles.card}>
          <div className={styles.row}><span className={styles.avatar}>{initials(brief.lead.name)}</span><h2 className={styles.cardTitle}>Customer</h2></div>
          <p>{brief.lead.name}</p>
          <p className={styles.note}>{brief.lead.email || "No email"}</p>
          <p className={styles.note}>{brief.lead.phone || "No phone number"}</p>
          {profile ? (
            <>
              <p className={styles.label}>Business</p>
              <p>{profile.businessType}</p>
              <p className={styles.note}>{profile.location} · {profile.sites} · {profile.size}</p>
              <p className={styles.note}>Setup: {profile.setup}</p>
              <p className={styles.note}>Pain: {profile.painPoints}</p>
            </>
          ) : null}
          <p className={styles.label}>Interest</p>
          <p>{brief.lead.interest}</p>
          <p className={styles.label}>Came from</p>
          <p>{brief.lead.cameFrom}</p>
        </section>
        <section className={styles.card}>
          <p className={styles.label}>Intent at close</p>
          <p className={styles.intent}>{brief.intent.label}</p>
          <div className={styles.meter}><span style={{ width: `${brief.intent.scale}%`, background: "var(--org)" }} /></div>
          <ul>{brief.intent.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </section>
        <section className={styles.navy}>
          <h2 className={styles.cardTitle}>Scheduled appointment</h2>
          <p>{brief.appointment.when ? new Date(brief.appointment.when).toLocaleString("en-GB") : "No meeting booked"}</p>
          <p>{brief.appointment.agenda}</p>
          {actionNote ? <p>{actionNote}</p> : null}
          <div className={styles.row} style={{ marginTop: 12 }}>
            <button type="button" className={styles.btnWarn} onClick={() => setActionNote(brief.appointment.booked ? "This meeting is on the owner's calendar. A join link was not stored." : "No meeting was booked.")}>Join</button>
            <button type="button" className={styles.btnGhost} onClick={() => setActionNote("Move the time on the connected calendar. This page does not email the lead.")}>Reschedule</button>
          </div>
        </section>
      </div>

      <section className={styles.opening} style={{ marginTop: 16 }}>
        <div className={styles.headRow}>
          <p className={styles.label} style={{ color: "#eef3ff", margin: 0 }}>Suggested opening line</p>
          <button type="button" className={styles.btnWarn} onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <p className={styles.quote}>{brief.openingLine}</p>
      </section>

      <section className={styles.card} style={{ marginTop: 16 }}>
        <div className={`${styles.scrollX} ${styles.timeline}`}>
          {brief.timeline.map((item) => (
            <div key={`${item.label}-${item.at}`} className={styles.tick}>
              <i />
              <strong>{item.label}</strong>
              <p className={styles.note}>{item.at ? new Date(item.at).toLocaleString("en-GB") : ""}</p>
            </div>
          ))}
          <div className={styles.tick}><i /><strong>Emails</strong><p className={styles.note}>None sent</p></div>
        </div>
      </section>

      <div className={styles.grid3} style={{ marginTop: 16 }}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>How it went</h2>
          <p>{brief.howItWent.summary}</p>
          <Meter label="Sentiment" value={brief.howItWent.sentiment} />
          <Meter label="Engagement" value={brief.howItWent.engagement} />
          <Meter label="Lead talk share" value={brief.howItWent.talkShareLead} />
          <p className={styles.note}>Mood: {brief.howItWent.mood}</p>
        </section>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Questions asked</h2>
          <QuestionList title="Questions the lead asked" empty="The lead did not ask a question." items={brief.questions.filter((item) => item.askedBy !== "agent")} seek={seek} />
          <QuestionList title="Questions we asked" empty="We did not ask a question." items={brief.questions.filter((item) => item.askedBy === "agent")} seek={seek} />
        </section>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Objections that nearly lost it</h2>
          {brief.objections.length ? null : <p>No objections raised</p>}
          {brief.objections.map((item) => (
            <div key={item.text} style={{ marginTop: 10 }}>
              <div className={styles.headRow}><span>{item.text}</span><span className={item.tag === "Resolved" ? styles.ok : styles.warn}>{item.tag}</span></div>
              <div className={styles.heat}><span style={{ width: `${item.heat}%` }} /></div>
            </div>
          ))}
        </section>
      </div>

      <div className={styles.grid2} style={{ marginTop: 16 }}>
        <section className={styles.card}><h2 className={styles.cardTitle}>Current provider</h2>
          {(brief.providers || []).length ? (brief.providers || []).map((item) => <p key={item.name}><button type="button" className={styles.link} onClick={() => seek(item.atSeconds)}>{formatStamp(item.atSeconds)}</button> {item.kind === "current" ? "Uses" : "Mentioned"} {item.name}</p>) : <p>{brief.rival || "None named"}</p>}
        </section>
        <section className={styles.card}><h2 className={styles.cardTitle}>Next steps</h2><ul>{brief.nextSteps.map((step) => <li key={step}>{step}</li>)}</ul></section>
      </div>

      <section className={styles.card} style={{ marginTop: 16 }}>
        <h2 className={styles.cardTitle}>Recording {data.durationLabel || ""}</h2>
        {recording ? (
          <>
            <audio
              ref={audioRef}
              controls
              preload="metadata"
              src={recording}
              onLoadedMetadata={(event) => {
                const audio = event.currentTarget;
                if (Number.isFinite(audio.duration)) return;
                const known = data.durationSeconds || 0;
                const reveal = () => {
                  audio.removeEventListener("timeupdate", reveal);
                  audio.currentTime = 0;
                };
                audio.addEventListener("timeupdate", reveal);
                try { audio.currentTime = known || 1e10; } catch { /* the known length still drives the chapters */ }
              }}
              onTimeUpdate={(event) => setPlayed(event.currentTarget.currentTime)}
            />
            {data.durationSeconds ? (
              <input
                type="range"
                min={0}
                max={data.durationSeconds}
                value={Math.min(played, data.durationSeconds)}
                aria-label="Seek in the recording"
                onChange={(event) => {
                  const at = Number(event.target.value);
                  if (audioRef.current) audioRef.current.currentTime = at;
                  setPlayed(at);
                }}
                style={{ width: "100%", marginTop: 8 }}
              />
            ) : null}
          </>
        ) : <p>No recording saved.</p>}
        <div className={styles.linkActions}>
          {(brief.chapters || []).map((chapter) => (
            <button key={`${chapter.kind}-${chapter.atSeconds}-${chapter.label}`} type="button" className={styles.btnGhost} onClick={() => seek(chapter.atSeconds, chapter.kind === "question")}>
              {formatStamp(chapter.atSeconds)} {chapter.label}
            </button>
          ))}
        </div>
        {(brief.slides || []).map((slide) => (
          <p key={`${slide.number}-${slide.atSeconds}`} className={styles.note}>
            <button type="button" className={styles.link} onClick={() => seek(slide.atSeconds, false)}>{formatStamp(slide.atSeconds)}</button>{" "}
            {slide.title} · {slide.durationSeconds}s · {slide.triggeredBy}
          </p>
        ))}
      </section>
      <footer className={styles.footer} style={{ marginTop: 16 }}>
        <button type="button" className={styles.btn} onClick={() => void fetch(`/api/crm/interviewer/calls/${sessionId}/brief`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "regenerate" }) }).then(() => window.location.reload())}>Regenerate brief</button>
        <button type="button" className={styles.btnGhost} onClick={() => void showTranscript()}>Full transcript</button>
        <button type="button" className={styles.btnGhost} onClick={() => void showRecording()}>Recording</button>
        <button type="button" className={styles.btnGhost} onClick={() => setOpen("cost")}>Internal cost</button>
      </footer>
      {open === "transcript" ? (
        <section className={styles.card} style={{ marginTop: 12 }}>
          {transcript.map((line) => (
            <p key={line.id} style={line.atSeconds != null && played >= line.atSeconds && played < line.atSeconds + 8 ? { background: "#EEF3FF" } : undefined}>
              <button type="button" className={styles.link} onClick={() => seek(line.atSeconds || 0, line.speaker !== "agent")}>{formatStamp(line.atSeconds || 0)}</button>{" "}
              <strong>{line.speaker === "agent" ? "Interviewa" : "Lead"}.</strong> {toSpokenPlain(line.text)}
            </p>
          ))}
        </section>
      ) : null}
      {open === "recording" ? <section className={styles.card} style={{ marginTop: 12 }}>{recording ? <audio controls src={recording} /> : <p>No recording saved.</p>}</section> : null}
      {open === "cost" ? (
        <section className={styles.card} style={{ marginTop: 12 }}>
          <p>{data.cost.label}</p>
          <p>Total {data.cost.amount}{data.cost.estimated ? " (estimate from duration)" : ""}</p>
          <p className={styles.note}>Agent {data.cost.voiceAgent} · listener {data.cost.listen} · LLM {data.cost.llm} · storage {data.cost.storage} · hosting {data.cost.vercel}</p>
        </section>
      ) : null}
      {brief.source === "record" ? <p className={styles.note}>This brief was drafted from the call record because a model summary was not available.</p> : null}
    </main>
  );
}
