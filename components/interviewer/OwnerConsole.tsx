"use client";

import { useEffect, useState } from "react";

import styles from "@/components/interviewer/interviewa.module.css";
import { voiceLabel } from "@/lib/interviewer/voices";

type Campaign = { id: string; name: string; voice_id: string; max_minutes: number | null };

export default function OwnerConsole() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    fetch("/api/crm/interviewer/campaigns", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setCampaigns(data.campaigns || []))
      .catch(() => setNote("The campaign list could not be loaded."));
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.pill}>Interviewa</p>
        <h1 className={styles.h1}>Campaigns</h1>
        <p className={styles.lede}>Each campaign is a name, a voice, and the knowledge the call is allowed to use.</p>
      </section>
      <div className={styles.headRow} style={{ margin: "16px 0" }}>
        <a className={`${styles.btn} ${styles.link}`} href="/crm/interviewer/campaigns/new" style={{ color: "#fff" }}>New campaign</a>
        <a className={styles.link} href="/crm">Back to CRM</a>
      </div>
      {note ? <p className={styles.err}>{note}</p> : null}
      <div className={styles.cards}>
        {campaigns.map((campaign) => (
          <a key={campaign.id} className={styles.card} href={`/crm/interviewer/campaigns/${campaign.id}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div className={styles.headRow}>
              <h2 className={styles.cardTitle}>{campaign.name}</h2>
              <span className={styles.ok}>Active</span>
            </div>
            <p className={styles.note} style={{ marginTop: 8 }}>{voiceLabel(campaign.voice_id)} · {campaign.max_minutes ? `${campaign.max_minutes} min` : "No cap"}</p>
          </a>
        ))}
      </div>
    </main>
  );
}
