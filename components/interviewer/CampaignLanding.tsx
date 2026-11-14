"use client";

import { useState, type CSSProperties } from "react";

import styles from "@/components/interviewer/interviewa.module.css";
import type { PublicCampaignView } from "@/lib/interviewer/public-campaign";

function keepProtection(path: string): string {
  const next = new URL(path, window.location.origin);
  const current = new URLSearchParams(window.location.search);
  for (const key of ["x-vercel-protection-bypass", "x-vercel-set-bypass-cookie"]) {
    const value = current.get(key);
    if (value) next.searchParams.set(key, value);
  }
  return `${next.pathname}${next.search}`;
}

export default function CampaignLanding({ card }: { card: PublicCampaignView }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [fax, setFax] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setFields({});
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setBusy(false);
      setError("The microphone is blocked. Allow it in the browser, then start the call.");
      return;
    }
    stream.getTracks().forEach((track) => track.stop());
    try { window.sessionStorage.setItem("interviewer-mic", "granted"); } catch { /* the call page can ask again */ }
    let response: Response;
    try {
      response = await fetch("/api/interviewer/public-join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: card.id,
          prospectName: name,
          prospectEmail: email,
          company_fax: fax,
        }),
      });
    } catch {
      setBusy(false);
      setError("The response didn't come back, so it isn't clear whether a call was opened. Wait a moment before trying again.");
      return;
    }
    const data = await response.json().catch(() => ({})) as { started?: boolean; path?: string; error?: string; fields?: Record<string, string> };
    if (!response.ok || !data.started || !data.path) {
      setBusy(false);
      setFields(data.fields || {});
      setError(data.error || "The call was not started. Nothing was saved.");
      return;
    }
    window.location.assign(keepProtection(data.path));
  };

  const tone = { "--land-accent": card.accent, "--land-on": card.accentOn } as CSSProperties;
  return (
    <main className={styles.landing} style={tone}>
      {card.heroUrl ? (
        <img className={styles.landingHero} src={card.heroUrl} alt={card.heroAlt} />
      ) : <div className={styles.landingHeroFallback} />}
      <section className={styles.landingCard}>
        <p className={styles.landingKicker}>A short call</p>
        <h1>{card.name}</h1>
        <p className={styles.landingSummary}>{card.summary}</p>
        {card.accepting ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void start();
            }}
          >
            <label className={styles.landingLabel}>
              Your name
              <input className={styles.landingField} name="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            {fields.prospectName ? <p className={styles.landingError}>{fields.prospectName}</p> : null}
            <label className={styles.landingLabel}>
              Email
              <input className={styles.landingField} name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            {fields.prospectEmail ? <p className={styles.landingError}>{fields.prospectEmail}</p> : null}
            <input
              className={styles.landingHoneypot}
              name="company_fax"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={fax}
              onChange={(event) => setFax(event.target.value)}
            />
            <button className={styles.landingStart} type="submit" disabled={busy}>
              {busy ? "Starting…" : "Start call"}
            </button>
            {error ? <p className={styles.landingError}>{error}</p> : null}
            <p className={styles.landingFine}>Up to {card.maxMinutes} minutes. No account needed.</p>
          </form>
        ) : (
          <p className={styles.landingSummary}>This campaign is not taking calls right now.</p>
        )}
      </section>
    </main>
  );
}
