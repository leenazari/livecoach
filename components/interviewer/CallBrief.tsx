"use client";

import { useEffect, useState } from "react";

import type { CallBrief as Brief } from "@/lib/interviewer/brief";
import styles from "@/components/interviewer/interviewa.module.css";

type Payload = {
  brief: Brief | null;
  hasRecording: boolean;
  scheduledAt: string | null;
  campaignId: string;
  cost: { label: string; amount: string; estimated: boolean; voiceAgent: string; listen: string; llm: string; storage: string; vercel: string };
};

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
  const [transcript, setTranscript] = useState<Array<{ id: string; speaker: string; text: string }>>([]);
  const [open, setOpen] = useState<"transcript" | "recording" | "cost" | "">("");
  const [recording, setRecording] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [actionNote, setActionNote] = useState("");

  useEffect(() => {
    fetch(`/api/crm/interviewer/calls/${sessionId}/brief`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "The brief could not be loaded.");
        setData(body);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "The brief could not be loaded."));
  }, [sessionId]);

  const brief = data?.brief;
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
        <div className={styles.timeline}>
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
          <ul>
            {brief.questions.map((item) => (
              <li key={item.question}>
                {item.question}{" "}
                <span className={item.status === "unanswered" ? styles.red : item.status === "partly" ? styles.warn : styles.ok}>{item.status}</span>
              </li>
            ))}
          </ul>
          {brief.questions.some((item) => item.status === "unanswered") ? <p className={styles.red}>Unanswered questions are flagged.</p> : null}
        </section>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Objections that nearly lost it</h2>
          {brief.objections.map((item) => (
            <div key={item.text} style={{ marginTop: 10 }}>
              <div className={styles.headRow}><span>{item.text}</span><span className={item.tag === "Resolved" ? styles.ok : styles.warn}>{item.tag}</span></div>
              <div className={styles.heat}><span style={{ width: `${item.heat}%` }} /></div>
            </div>
          ))}
        </section>
      </div>

      <div className={styles.grid2} style={{ marginTop: 16 }}>
        <section className={styles.card}><h2 className={styles.cardTitle}>Rival named</h2><p>{brief.rival || "None named"}</p></section>
        <section className={styles.card}><h2 className={styles.cardTitle}>Next steps</h2><ul>{brief.nextSteps.map((step) => <li key={step}>{step}</li>)}</ul></section>
      </div>

      <footer className={styles.footer} style={{ marginTop: 16 }}>
        <button type="button" className={styles.btnGhost} onClick={() => void showTranscript()}>Full transcript</button>
        <button type="button" className={styles.btnGhost} onClick={() => void showRecording()}>Recording</button>
        <button type="button" className={styles.btnGhost} onClick={() => setOpen("cost")}>Internal cost</button>
      </footer>
      {open === "transcript" ? (
        <section className={styles.card} style={{ marginTop: 12 }}>
          {transcript.map((line) => <p key={line.id}><strong>{line.speaker === "agent" ? "Interviewa" : "Lead"}.</strong> {line.text}</p>)}
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
