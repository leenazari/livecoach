"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MatrixRain from "@/components/MatrixRain";
import NavMenu from "@/components/crm/NavMenu";
import { crmFetch, getCached, setCached } from "@/lib/crm";
import {
  COACHING_STYLE_LABELS,
  COACHING_STYLES,
  DEFAULT_SALES_PROFILE,
  EMAIL_TONE_LABELS,
  EMAIL_TONES,
  SUGGESTION_FREQUENCIES,
  SUGGESTION_FREQUENCY_LABELS,
  type SalesProfile,
  type SalesProfileResponse,
} from "@/lib/sales-profile-types";
import type {
  SalespersonVoiceChoice,
  SalespersonVoiceLibraryResponse,
} from "@/lib/salesperson-voice-library-types";
import {
  OUTREACH_SHARED_DEFAULT_VOICE_ID,
  OUTREACH_SHARED_DEFAULT_VOICE_NAME,
} from "@/lib/outreach-voice-default";

const PROFILE_URL = "/api/crm/sales-profile";
const VOICES_URL = "/api/crm/sales-profile/voices";

const lines = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);

const textArea =
  "min-h-28 w-full resize-y rounded-xl border border-edge bg-ink/55 px-4 py-3 text-sm leading-relaxed text-bone outline-none placeholder:text-muted/60 focus:border-amber/60";
const input =
  "min-h-12 w-full rounded-xl border border-edge bg-ink/55 px-4 text-sm text-bone outline-none placeholder:text-muted/60 focus:border-amber/60";

export default function SalesProfilePage() {
  const cached = getCached<SalesProfileResponse>(PROFILE_URL);
  const [data, setData] = useState<SalesProfileResponse | null>(cached || null);
  const [profile, setProfile] = useState<SalesProfile>(
    cached?.profile || DEFAULT_SALES_PROFILE
  );
  const [productText, setProductText] = useState(
    cached?.profile.productFocus.join("\n") || ""
  );
  const [customerText, setCustomerText] = useState(
    cached?.profile.customerFocus.join("\n") || ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [voices, setVoices] = useState<SalespersonVoiceChoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voicesError, setVoicesError] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState("");
  const [showAllVoices, setShowAllVoices] = useState(false);
  const [voicePurpose, setVoicePurpose] = useState<
    "email-assistant" | "outreach"
  >("email-assistant");
  const voiceAudio = useRef<HTMLAudioElement | null>(null);
  const touched = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await crmFetch<SalesProfileResponse>(PROFILE_URL);
      setData(next);
      if (!touched.current) {
        setProfile(next.profile);
        setProductText(next.profile.productFocus.join("\n"));
        setCustomerText(next.profile.customerFocus.join("\n"));
      }
    } catch (err: any) {
      setError(err?.message || "Your setup could not be loaded");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    const loadVoices = async () => {
      setVoicesLoading(true);
      setVoicesError("");
      try {
        const result = await crmFetch<SalespersonVoiceLibraryResponse>(VOICES_URL);
        if (active) setVoices(result.voices || []);
      } catch (err: any) {
        if (active)
          setVoicesError(err?.message || "The stock voice library could not be loaded");
      } finally {
        if (active) setVoicesLoading(false);
      }
    };
    void loadVoices();
    return () => {
      active = false;
      voiceAudio.current?.pause();
      voiceAudio.current = null;
    };
  }, []);

  const draft = useMemo(
    () => ({
      ...profile,
      productFocus: lines(productText),
      customerFocus: lines(customerText),
    }),
    [profile, productText, customerText]
  );

  const markTouched = () => {
    touched.current = true;
    setSaved("");
    setError("");
  };

  const update = <K extends keyof SalesProfile>(
    key: K,
    value: SalesProfile[K]
  ) => {
    markTouched();
    setProfile((current) => ({ ...current, [key]: value }));
  };

  const previewVoice = async (voice: SalespersonVoiceChoice) => {
    if (!voice.previewUrl) {
      setVoicesError("This stock voice does not include a preview");
      return;
    }
    if (playingVoiceId === voice.id) {
      voiceAudio.current?.pause();
      voiceAudio.current = null;
      setPlayingVoiceId("");
      return;
    }
    voiceAudio.current?.pause();
    const audio = new Audio(voice.previewUrl);
    voiceAudio.current = audio;
    setVoicesError("");
    setPlayingVoiceId(voice.id);
    audio.onended = () => setPlayingVoiceId("");
    audio.onerror = () => {
      setPlayingVoiceId("");
      setVoicesError("That voice preview could not be played");
    };
    try {
      await audio.play();
    } catch {
      setPlayingVoiceId("");
      setVoicesError("Your browser blocked that voice preview. Press Listen again.");
    }
  };

  const chooseVoice = (
    target: "email-assistant" | "outreach",
    voice: SalespersonVoiceChoice
  ) => {
    markTouched();
    setProfile((current) =>
      target === "email-assistant"
        ? {
            ...current,
            emailAssistantVoiceId: voice.id,
            emailAssistantVoiceName: voice.name,
          }
        : {
            ...current,
            outreachVoiceId: voice.id,
            outreachVoiceName: voice.name,
          }
    );
  };

  const useSharedOutreachDefault = () => {
    markTouched();
    setProfile((current) => ({
      ...current,
      outreachVoiceId: "",
      outreachVoiceName: "",
    }));
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const next = await crmFetch<SalesProfileResponse>(PROFILE_URL, {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      setData(next);
      setProfile(next.profile);
      setProductText(next.profile.productFocus.join("\n"));
      setCustomerText(next.profile.customerFocus.join("\n"));
      setCached(PROFILE_URL, next);
      touched.current = false;
      setSaved(`Saved at ${new Date(next.profile.updatedAt || Date.now()).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`);
    } catch (err: any) {
      setError(
        `${err?.message || "Your setup was not saved"}. Your entries are still here.`
      );
    } finally {
      setBusy(false);
    }
  };

  const complete =
    !!draft.roleTitle &&
    draft.productFocus.length > 0 &&
    draft.customerFocus.length > 0;

  return (
    <main className="relative z-10 mx-auto max-w-[980px] px-4 py-8 sm:px-6 sm:py-10">
      <NavMenu />
      <header className="mb-6 flex flex-col gap-4 border-b border-edge pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-amber">
            Personal to your login
          </p>
          <h1 className="mt-1 font-display text-2xl text-bone">My Sales Setup</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            This tells Brain, Email Assistant, Outreach and Live Coach how to work with you. It never opens another user&apos;s private calls, email, calendar or memory.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={busy || !complete}
          className="min-h-12 rounded-full bg-amber px-6 font-mono text-xs font-semibold uppercase tracking-wider text-ink disabled:opacity-45"
        >
          {busy ? "Saving…" : profile.completedAt ? "Save changes" : "Finish setup"}
        </button>
      </header>

      {!data && !error ? (
        <MatrixRain
          size="panel"
          messages={["loading your private setup", "checking your own connections"]}
        />
      ) : null}

      {error ? (
        <p role="alert" className="mb-5 rounded-xl border border-rust/50 bg-rust/10 px-4 py-3 text-sm text-rust">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="mb-5 rounded-xl border border-sage/50 bg-sage/10 px-4 py-3 text-sm text-sage">
          {saved}. Your future Brain, Email Assistant, Outreach and coaching prompts now use this version.
        </p>
      ) : null}

      {data ? (
        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-edge bg-panel/45 p-4">
              <p className="font-mono text-[0.56rem] uppercase tracking-wider text-muted">Signed in</p>
              <p className="mt-2 text-sm text-bone">{data.identity.displayName || data.identity.accountEmail}</p>
              <p className="mt-1 truncate text-xs text-muted">{data.identity.accountEmail}</p>
            </div>
            <div className={`rounded-2xl border p-4 ${data.identity.connector.provider ? "border-sage/45 bg-sage/[0.06]" : "border-amber/45 bg-amber/[0.06]"}`}>
              <p className="font-mono text-[0.56rem] uppercase tracking-wider text-muted">Email and calendar</p>
              <p className={`mt-2 text-sm ${data.identity.connector.provider ? "text-sage" : "text-amber"}`}>
                {data.identity.connector.provider
                  ? `${data.identity.connector.provider === "google" ? "Google" : "Microsoft"} connected`
                  : "Not connected yet"}
              </p>
              <p className="mt-1 truncate text-xs text-muted">{data.identity.connector.email || "Connect later in Settings"}</p>
            </div>
            <div className="rounded-2xl border border-sage/45 bg-sage/[0.06] p-4">
              <p className="font-mono text-[0.56rem] uppercase tracking-wider text-muted">Your notetaker</p>
              <p className="mt-2 text-sm text-sage">Separate identity ready</p>
              <p className="mt-1 text-xs text-muted">{data.identity.transcriberName}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-edge bg-panel/45 p-5 sm:p-6">
            <p className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-sage">1. Your remit</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm text-bone">Your role or sales focus</span>
                <input
                  value={profile.roleTitle}
                  onChange={(event) => update("roleTitle", event.target.value)}
                  className={input}
                  placeholder="Sales Manager for Interviewa"
                  maxLength={120}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-bone">Your target</span>
                <input
                  value={profile.salesGoal}
                  onChange={(event) => update("salesGoal", event.target.value)}
                  className={input}
                  placeholder="For example, book qualified demos and close new revenue"
                  maxLength={500}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-bone">Products you sell</span>
                <textarea
                  value={productText}
                  onChange={(event) => {
                    markTouched();
                    setProductText(event.target.value);
                  }}
                  className={textArea}
                  placeholder={"Interviewa screening\nInterviewa candidate training"}
                />
                <span className="mt-1 block text-xs text-muted">One per line. Maximum 12.</span>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-bone">Customer types you focus on</span>
                <textarea
                  value={customerText}
                  onChange={(event) => {
                    markTouched();
                    setCustomerText(event.target.value);
                  }}
                  className={textArea}
                  placeholder={"Recruitment agencies\nHigh volume hiring teams"}
                />
                <span className="mt-1 block text-xs text-muted">One per line. Maximum 12.</span>
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-edge bg-panel/45 p-5 sm:p-6">
            <p className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-sage">2. How LiveCoach should sound</p>
            <div className="mt-4 grid gap-5 lg:grid-cols-3">
              <fieldset>
                <legend className="mb-2 text-sm text-bone">Email tone</legend>
                <div className="space-y-2">
                  {EMAIL_TONES.map((tone) => (
                    <button key={tone} type="button" onClick={() => update("emailTone", tone)} className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${profile.emailTone === tone ? "border-amber/60 bg-amber/10 text-amber" : "border-edge bg-ink/35 text-muted"}`}>
                      {EMAIL_TONE_LABELS[tone]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-sm text-bone">Coaching style</legend>
                <div className="space-y-2">
                  {COACHING_STYLES.map((style) => (
                    <button key={style} type="button" onClick={() => update("coachingStyle", style)} className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${profile.coachingStyle === style ? "border-amber/60 bg-amber/10 text-amber" : "border-edge bg-ink/35 text-muted"}`}>
                      {COACHING_STYLE_LABELS[style]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-sm text-bone">Live suggestion frequency</legend>
                <div className="space-y-2">
                  {SUGGESTION_FREQUENCIES.map((frequency) => (
                    <button key={frequency} type="button" onClick={() => update("suggestionFrequency", frequency)} className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${profile.suggestionFrequency === frequency ? "border-amber/60 bg-amber/10 text-amber" : "border-edge bg-ink/35 text-muted"}`}>
                      {SUGGESTION_FREQUENCY_LABELS[frequency]}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
            <label className="mt-5 block">
              <span className="mb-2 block text-sm text-bone">Your normal email sign off</span>
              <input
                value={profile.emailSignoff}
                onChange={(event) => update("emailSignoff", event.target.value)}
                className={input}
                placeholder="Best, Jimmy"
                maxLength={160}
              />
            </label>
            <label className="mt-5 block">
              <span className="mb-2 block text-sm text-bone">Your personal booking link</span>
              <input
                type="url"
                value={profile.bookingUrl}
                onChange={(event) => update("bookingUrl", event.target.value)}
                className={input}
                placeholder="https://calendar.google.com/calendar/appointments/…"
                maxLength={500}
              />
              <span className="mt-1 block text-xs leading-5 text-muted">
                Outreach and Email Assistant use this exact salesperson-specific link when a meeting is the approved next step. A teammate, campaign or global link can never replace it.
              </span>
            </label>
            <div className="mt-5 rounded-2xl border border-edge bg-ink/25 p-4 sm:p-5">
              <p className="text-sm text-bone">Separate voice settings</p>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
                Pick one product at a time. Email Assistant needs its own saved choice. Outreach uses the shared Sam Elliott default until this salesperson chooses an override. Neither can borrow Brain&apos;s voice or the other product&apos;s setting.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setVoicePurpose("email-assistant")}
                  className={`rounded-xl border p-3 text-left ${voicePurpose === "email-assistant" ? "border-sky/60 bg-sky/[0.09]" : "border-edge bg-panel/30"}`}
                >
                  <p className="font-mono text-[0.52rem] uppercase tracking-wider text-sky">Email Assistant reply voice</p>
                  <p className="mt-1 text-sm text-bone">
                    {profile.emailAssistantVoiceId
                      ? profile.emailAssistantVoiceName || "Reply voice selected"
                      : "Not selected"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted">Used only for approved voice replies attached to next-move emails.</p>
                </button>
                <button
                  type="button"
                  onClick={() => setVoicePurpose("outreach")}
                  className={`rounded-xl border p-3 text-left ${voicePurpose === "outreach" ? "border-amber/60 bg-amber/[0.09]" : "border-edge bg-panel/30"}`}
                >
                  <p className="font-mono text-[0.52rem] uppercase tracking-wider text-amber">Outreach campaign voice</p>
                  <p className="mt-1 text-sm text-bone">
                    {profile.outreachVoiceId
                      ? profile.outreachVoiceName || "Outreach voice selected"
                      : OUTREACH_SHARED_DEFAULT_VOICE_NAME}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {profile.outreachVoiceId
                      ? "Personal override used across this salesperson's Outreach campaigns."
                      : "Shared default used across this salesperson's Outreach campaigns."}
                  </p>
                </button>
              </div>

              <div className={`mt-4 rounded-xl border p-3 ${voicePurpose === "email-assistant" ? "border-sky/35 bg-sky/[0.04]" : "border-amber/35 bg-amber/[0.04]"}`}>
                <p className={`font-mono text-[0.54rem] uppercase tracking-wider ${voicePurpose === "email-assistant" ? "text-sky" : "text-amber"}`}>
                  {voicePurpose === "email-assistant"
                    ? "Choose only the Email Assistant reply voice"
                    : "Choose only the Outreach campaign voice"}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Listening to a preview is free. Saving a selection does not generate audio or incur a voice cost.
                </p>

                {voicePurpose === "outreach" ? (
                  <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber/35 bg-ink/25 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm text-bone">{OUTREACH_SHARED_DEFAULT_VOICE_NAME}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        Shared default for every salesperson and campaign until a personal override is saved.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={useSharedOutreachDefault}
                      disabled={!profile.outreachVoiceId}
                      className="min-h-10 shrink-0 rounded-lg border border-amber/55 bg-amber/10 px-3 font-mono text-[0.52rem] uppercase tracking-wider text-amber disabled:opacity-45"
                    >
                      {profile.outreachVoiceId
                        ? "Use shared default"
                        : `✓ Default · ${OUTREACH_SHARED_DEFAULT_VOICE_ID.slice(-4)}`}
                    </button>
                  </div>
                ) : null}

                {voicesLoading ? (
                  <div className="mt-4">
                    <MatrixRain size="compact" messages={["loading stock voices", "previews cost nothing"]} />
                  </div>
                ) : null}
                {voicesError ? (
                  <p role="alert" className="mt-4 rounded-xl border border-rust/45 bg-rust/10 px-3 py-2 text-xs leading-5 text-rust">
                    {voicesError}
                  </p>
                ) : null}
                {!voicesLoading && voices.length ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {(showAllVoices ? voices : voices.slice(0, 8)).map((voice) => {
                      const selected =
                        voicePurpose === "email-assistant"
                          ? profile.emailAssistantVoiceId === voice.id
                          : profile.outreachVoiceId === voice.id;
                      const detail = [voice.accent, voice.gender, voice.age, voice.useCase]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <article key={voice.id} className={`rounded-xl border p-3 transition ${selected ? "border-bone/45 bg-bone/[0.04]" : "border-edge bg-panel/35 hover:border-bone/35"}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-bone">{voice.name}</p>
                              <p className="mt-1 truncate font-mono text-[0.52rem] uppercase tracking-wider text-muted">
                                {detail || "ElevenLabs stock voice"}
                              </p>
                            </div>
                            {selected ? (
                              <span className={voicePurpose === "email-assistant" ? "text-xs text-sky" : "text-xs text-amber"}>
                                ✓ Selected
                              </span>
                            ) : null}
                          </div>
                          {voice.description ? (
                            <p className="mt-2 line-clamp-2 text-xs leading-5 text-bone/70">{voice.description}</p>
                          ) : null}
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <button type="button" onClick={() => void previewVoice(voice)} disabled={!voice.previewUrl} className="min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.52rem] uppercase tracking-wider text-bone disabled:opacity-35">
                              {playingVoiceId === voice.id ? "Stop" : "Listen"}
                            </button>
                            <button
                              type="button"
                              onClick={() => chooseVoice(voicePurpose, voice)}
                              disabled={selected}
                              className={`min-h-10 rounded-lg border px-3 font-mono text-[0.52rem] uppercase tracking-wider disabled:opacity-45 ${voicePurpose === "email-assistant" ? "border-sky/55 bg-sky/10 text-sky" : "border-amber/55 bg-amber/10 text-amber"}`}
                            >
                              {selected
                                ? "✓ Selected"
                                : voicePurpose === "email-assistant"
                                  ? "Use for Email Assistant"
                                  : "Use for Outreach"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
                {voices.length > 8 ? (
                  <button type="button" onClick={() => setShowAllVoices((value) => !value)} className="mt-3 text-xs text-amber hover:underline">
                    {showAllVoices ? "Show fewer voices" : `Show all ${voices.length} stock voices`}
                  </button>
                ) : null}
              </div>
              <p className="mt-3 text-xs leading-5 text-muted">
                Personal selections belong only to this login. Outreach falls back to the shared default. Email Assistant audio still stops safely until its separate voice is chosen. Email-only work is unaffected.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-edge bg-panel/45 p-5 sm:p-6">
            <p className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-sage">3. Your working rhythm</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="mb-2 block text-sm text-bone">Start time</span>
                <input type="time" value={profile.workdayStart} onChange={(event) => update("workdayStart", event.target.value)} className={input} />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-bone">Finish time</span>
                <input type="time" value={profile.workdayEnd} onChange={(event) => update("workdayEnd", event.target.value)} className={input} />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-bone">Time zone</span>
                <select value={profile.timezone} onChange={(event) => update("timezone", event.target.value)} className={input}>
                  <option value="Europe/London">UK time</option>
                  <option value="Europe/Dublin">Ireland time</option>
                  <option value="America/New_York">US Eastern time</option>
                  <option value="America/Chicago">US Central time</option>
                  <option value="America/Los_Angeles">US Pacific time</option>
                </select>
              </label>
            </div>
            <label className="mt-5 block">
              <span className="mb-2 block text-sm text-bone">Anything else that helps you work well</span>
              <textarea
                value={profile.personalContext}
                onChange={(event) => update("personalContext", event.target.value)}
                className={textArea}
                maxLength={1000}
                placeholder="For example, challenge me when I avoid asking for a dated next step. Keep live prompts short because I speak quickly."
              />
              <span className="mt-1 block text-xs text-muted">Keep this practical. LiveCoach reuses it directly without paying to summarise it again.</span>
            </label>
          </section>

          <div className="sticky bottom-20 z-20 rounded-2xl border border-amber/45 bg-panel/95 p-3 shadow-2xl backdrop-blur sm:bottom-4 sm:flex sm:items-center sm:justify-between sm:px-5">
            <p className="mb-3 text-xs text-muted sm:mb-0">
              {complete
                ? "Ready to save. Changes apply to your future prompts only."
                : "Add your role, at least one product and at least one customer type."}
            </p>
            <div className="flex gap-2">
              <Link href="/settings" className="flex min-h-11 items-center rounded-full border border-edge px-4 font-mono text-[0.6rem] uppercase tracking-wider text-muted">
                Connections
              </Link>
              <button type="button" onClick={save} disabled={busy || !complete} className="min-h-11 flex-1 rounded-full bg-amber px-5 font-mono text-[0.62rem] font-semibold uppercase tracking-wider text-ink disabled:opacity-45 sm:flex-none">
                {busy ? "Saving…" : profile.completedAt ? "Save changes" : "Finish setup"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
