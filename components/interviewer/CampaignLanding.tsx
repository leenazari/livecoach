"use client";

import { useState } from "react";

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

function sampleBrand(image: HTMLImageElement, root: HTMLElement) {
  const canvas = document.createElement("canvas");
  const size = 24;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.drawImage(image, 0, 0, size, size);
  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(0, 0, size, size).data;
  } catch {
    return;
  }
  let best = { score: 0, r: 21, g: 93, b: 252 };
  let paperR = 0;
  let paperG = 0;
  let paperB = 0;
  let paper = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const sat = max - min;
    const light = (max + min) / 2;
    if (light > 214 && sat < 28) {
      paperR += red;
      paperG += green;
      paperB += blue;
      paper += 1;
      continue;
    }
    const score = sat * (light > 36 && light < 220 ? 1 : 0.25);
    if (score > best.score) best = { score, r: red, g: green, b: blue };
  }
  root.style.setProperty("--land-accent", `rgb(${best.r} ${best.g} ${best.b})`);
  const luminance = (0.2126 * best.r) + (0.7152 * best.g) + (0.0722 * best.b);
  root.style.setProperty("--land-on", luminance > 170 ? "#101828" : "#ffffff");
  if (paper > 12) {
    root.style.setProperty("--land-paper", `rgb(${Math.round(paperR / paper)} ${Math.round(paperG / paper)} ${Math.round(paperB / paper)})`);
    root.style.setProperty("--land-bg", `rgb(${Math.round(paperR / paper)} ${Math.round(paperG / paper)} ${Math.round(paperB / paper)})`);
  }
}

export default function CampaignLanding({ card }: { card: PublicCampaignView }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [fax, setFax] = useState("");
  const [hero, setHero] = useState(true);
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

  return (
    <main className={styles.landing}>
      {hero ? (
        <img
          className={styles.landingHero}
          src={`/api/interviewer/public-slide?campaign=${card.id}`}
          alt=""
          onLoad={(event) => sampleBrand(event.currentTarget, event.currentTarget.closest("main") || document.body)}
          onError={() => setHero(false)}
        />
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
