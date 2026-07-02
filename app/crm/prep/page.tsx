"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { crmFetch, getCached } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";

type Call = {
  id: string;
  candidate: string | null;
  role: string | null;
  created_at: string;
  summary: any;
};

type Task = {
  id: string;
  text: string;
  kind: string;
  status: string;
};

type Battlecard = {
  oneLiner: string;
  fit: { strong: string[]; weak: string[] };
  pitch: string;
  flow: { minutes: string; label: string }[];
  objections: { objection: string; response: string; haveReady: string | null }[];
  doNotSay: string[];
  questionsToAsk: string[];
  nextStep: string;
  sources: { title: string; url: string }[];
  generatedAt?: string;
};

const fmtDate = (iso?: string) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

const list = (v: any): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];

function Actions({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: string;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-2.5">
      <p
        className={`mb-1 font-mono text-[0.54rem] uppercase tracking-[0.18em] ${tone}`}
      >
        {title}
      </p>
      <ul className="flex flex-col gap-1">
        {items.map((t, i) => (
          <li
            key={i}
            className="flex gap-2 font-sans text-[0.8rem] leading-snug text-bone/85"
          >
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted" />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PrepInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const companyId = sp.get("company") || "";
  const companyNameParam = sp.get("companyName") || "";
  const upcomingId = sp.get("upcoming") || "";

  const callsUrl = `/api/crm/companies/${companyId}/calls`;
  const tasksUrl = `/api/crm/tasks?companyId=${companyId}`;
  const companyUrl = `/api/crm/companies/${companyId}`;

  const [name, setName] = useState(companyNameParam);
  const [calls, setCalls] = useState<Call[]>(
    getCached<{ calls: Call[] }>(callsUrl)?.calls || []
  );
  const [tasks, setTasks] = useState<Task[]>(
    getCached<{ tasks: Task[] }>(tasksUrl)?.tasks || []
  );
  const [playbook, setPlaybook] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [intent, setIntent] = useState("");
  const [rationale, setRationale] = useState("");
  const [gen, setGen] = useState(false);
  const [genErr, setGenErr] = useState("");
  const [savedToCall, setSavedToCall] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAllCalls, setShowAllCalls] = useState(false);

  const [battlecard, setBattlecard] = useState<Battlecard | null>(null);
  const [bcBusy, setBcBusy] = useState(false);
  const [bcErr, setBcErr] = useState("");

  useEffect(() => {
    if (!companyId) return;
    crmFetch<{ calls: Call[] }>(callsUrl)
      .then((d) => setCalls(d.calls || []))
      .catch(() => {});
    crmFetch<{ tasks: Task[] }>(tasksUrl)
      .then((d) => setTasks(d.tasks || []))
      .catch(() => {});
    crmFetch<{ company: { name: string; profile: any } }>(companyUrl)
      .then((d) => {
        if (d.company?.name) setName(d.company.name);
        const pb = d.company?.profile?.playbook;
        setPlaybook(
          Array.isArray(pb)
            ? pb.filter((p: any) => typeof p === "string" && p.trim())
            : []
        );
        const bc = d.company?.profile?.battlecard;
        if (bc && typeof bc === "object") setBattlecard(bc as Battlecard);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // Open to-dos worth carrying into the intent. The tasks endpoint also injects
  // a derived "Prep: ..." meta item per upcoming call - drop those, they are
  // about prepping, not things to do for the client.
  const openTodos = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "open" && t.kind !== "prep")
        .map((t) => t.text)
        .filter(Boolean),
    [tasks]
  );

  const suggest = async () => {
    if (gen || !companyId) return;
    setGen(true);
    setGenErr("");
    setSavedToCall(false);
    try {
      const d = await crmFetch<{ intent: string; rationale: string }>(
        `/api/crm/companies/${companyId}/prep-intent`,
        { method: "POST" }
      );
      setIntent(d.intent || "");
      setRationale(d.rationale || "");
    } catch (e: any) {
      setGenErr(e?.message || "could not suggest an intent");
    } finally {
      setGen(false);
    }
  };

  const generateBattlecard = async () => {
    if (bcBusy || !companyId) return;
    setBcBusy(true);
    setBcErr("");
    try {
      const d = await crmFetch<{ battlecard: Battlecard }>(
        `/api/crm/companies/${companyId}/battlecard`,
        {
          method: "POST",
          body: JSON.stringify({ intent: intent.trim() || undefined }),
        }
      );
      if (d.battlecard) setBattlecard(d.battlecard);
    } catch (e: any) {
      setBcErr(e?.message || "could not build the battlecard");
    } finally {
      setBcBusy(false);
    }
  };

  const startCall = () => {
    const qs = new URLSearchParams();
    if (companyId) qs.set("company", companyId);
    if (name) qs.set("companyName", name);
    if (intent.trim()) qs.set("intent", intent.trim());
    if (upcomingId) qs.set("upcoming", upcomingId);
    router.push(`/call?${qs.toString()}`);
  };

  const saveToScheduled = async () => {
    if (!upcomingId || !intent.trim()) return;
    await crmFetch(`/api/crm/upcoming/${upcomingId}`, {
      method: "PATCH",
      body: JSON.stringify({ intent: intent.trim() }),
    }).catch(() => {});
    setSavedToCall(true);
    window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
  };

  const copyIntent = async () => {
    try {
      await navigator.clipboard.writeText(intent.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  };

  const shownCalls = showAllCalls ? calls : calls.slice(0, 5);

  if (!companyId) {
    return (
      <main className="relative z-10 mx-auto max-w-[820px] px-5 py-10">
        <p className="font-mono text-[0.7rem] text-muted">
          No client selected. Open prep from a client or an upcoming call.
        </p>
        <Link
          href="/crm"
          className="mt-3 inline-block rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          ◂ clients
        </Link>
        <NavMenu />
      </main>
    );
  }

  return (
    <main className="relative z-10 mx-auto max-w-[860px] px-5 py-10">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
        <div className="flex items-baseline gap-3">
          <Link
            href={`/crm/${companyId}`}
            className="font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:text-amber"
          >
            ◂ {name || "client"}
          </Link>
          <h1 className="font-display text-[1.4rem] leading-none tracking-tight text-bone">
            <span className="italic text-amber">Prep</span>{" "}
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted">
              next call
            </span>
          </h1>
        </div>
        <Link
          href={
            upcomingId
              ? `/call?company=${companyId}&companyName=${encodeURIComponent(
                  name
                )}&upcoming=${upcomingId}`
              : `/call?company=${companyId}&companyName=${encodeURIComponent(
                  name
                )}`
          }
          className="rounded-full border border-sage/60 bg-sage/15 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-sage transition hover:bg-sage/25"
        >
          open call screen ▸
        </Link>
      </header>

      {/* SUGGESTED INTENT - the review card. Nothing is saved or used until you
          start the call or save it to the schedule. */}
      <section className="mb-6 rounded-2xl border border-amber/40 bg-amber/[0.05] p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-amber">
            ✶ Suggested intent
          </p>
          <button
            type="button"
            onClick={suggest}
            disabled={gen}
            className="rounded-full border border-amber/60 bg-amber/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
          >
            {gen
              ? "thinking…"
              : intent
              ? "↻ regenerate"
              : "suggest from history"}
          </button>
        </div>

        {!intent && !gen && (
          <p className="font-sans text-[0.84rem] leading-relaxed text-bone/75">
            Pull a fresh intent for your next call with {name || "this client"},
            built from the last call's open actions, what they still owe you, the
            playbook and your open to-dos. Review and edit it, then start the
            call with it. Nothing is saved until you do.
          </p>
        )}

        {genErr && (
          <p className="mt-1 font-mono text-[0.66rem] text-rust">{genErr}</p>
        )}

        {(intent || gen) && (
          <>
            <textarea
              value={intent}
              onChange={(e) => {
                setIntent(e.target.value);
                setSavedToCall(false);
              }}
              rows={5}
              placeholder={gen ? "building your intent…" : ""}
              className="mt-1 w-full resize-y rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60"
            />
            {rationale && (
              <p className="mt-2 font-sans text-[0.78rem] leading-snug text-bone/60">
                <span className="font-mono text-[0.56rem] uppercase tracking-wider text-muted">
                  why this:{" "}
                </span>
                {rationale}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={startCall}
                disabled={!intent.trim()}
                className="rounded-full border border-sage/60 bg-sage/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-sage transition hover:bg-sage/25 disabled:opacity-40"
              >
                start call with this ▸
              </button>
              {upcomingId && (
                <button
                  type="button"
                  onClick={saveToScheduled}
                  disabled={!intent.trim()}
                  className="rounded-full border border-sky/60 bg-sky/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-sky transition hover:bg-sky/25 disabled:opacity-40"
                >
                  {savedToCall ? "saved to call ✓" : "save to scheduled call"}
                </button>
              )}
              <button
                type="button"
                onClick={copyIntent}
                disabled={!intent.trim()}
                className="rounded-full border border-edge px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber disabled:opacity-40"
              >
                {copied ? "copied ✓" : "copy"}
              </button>
            </div>
          </>
        )}
      </section>

      {/* BATTLE PLAN - the grounded, call-specific playbook: objections with
          the right response, flow, what not to say, questions, next step. */}
      <section className="mb-6 rounded-2xl border border-rust/40 bg-rust/[0.05] p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-rust">
            ⚑ Battle plan
          </p>
          <button
            type="button"
            onClick={generateBattlecard}
            disabled={bcBusy}
            className="rounded-full border border-rust/60 bg-rust/15 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-rust transition hover:bg-rust/25 disabled:opacity-40"
          >
            {bcBusy
              ? "researching…"
              : battlecard
              ? "↻ rebuild"
              : "build battle plan"}
          </button>
        </div>

        {!battlecard && !bcBusy && (
          <p className="font-sans text-[0.84rem] leading-relaxed text-bone/75">
            Build a call-specific playbook for {name || "this client"}: the
            objections they will raise with the honest response, where the
            product fits and where it does not, a timed flow, the spoken pitch,
            what not to say, sharp questions, and the next step. It researches
            the client on the web and grounds the product answers in your brain
            and objection stances. Takes a few seconds and a few pence.
          </p>
        )}
        {bcBusy && !battlecard && (
          <p className="font-mono text-[0.7rem] text-muted">
            Researching the client and assembling the plan…
          </p>
        )}
        {bcErr && (
          <p className="mt-1 font-mono text-[0.66rem] text-rust">{bcErr}</p>
        )}

        {battlecard && (
          <div className="mt-1 flex flex-col gap-4">
            {battlecard.oneLiner && (
              <p className="font-sans text-[0.9rem] leading-snug text-bone">
                {battlecard.oneLiner}
              </p>
            )}

            {(battlecard.fit?.strong?.length > 0 ||
              battlecard.fit?.weak?.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {battlecard.fit?.strong?.length > 0 && (
                  <div className="rounded-xl border border-edge bg-ink/40 p-3">
                    <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-sage">
                      Strong fit
                    </p>
                    <ul className="flex flex-col gap-1">
                      {battlecard.fit.strong.map((t, i) => (
                        <li
                          key={i}
                          className="flex gap-2 font-sans text-[0.8rem] leading-snug text-bone/85"
                        >
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-sage/70" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {battlecard.fit?.weak?.length > 0 && (
                  <div className="rounded-xl border border-edge bg-ink/40 p-3">
                    <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-rust">
                      Weak fit, do not oversell
                    </p>
                    <ul className="flex flex-col gap-1">
                      {battlecard.fit.weak.map((t, i) => (
                        <li
                          key={i}
                          className="flex gap-2 font-sans text-[0.8rem] leading-snug text-bone/85"
                        >
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rust/70" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {battlecard.pitch && (
              <div className="rounded-xl border border-edge bg-ink/40 p-3">
                <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-amber">
                  The spoken pitch
                </p>
                <p className="font-sans text-[0.84rem] leading-relaxed text-bone/85">
                  {battlecard.pitch}
                </p>
              </div>
            )}

            {battlecard.flow?.length > 0 && (
              <div>
                <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-sky">
                  Suggested flow
                </p>
                <ul className="flex flex-col gap-1.5">
                  {battlecard.flow.map((f, i) => (
                    <li key={i} className="flex gap-2.5">
                      {f.minutes && (
                        <span className="mt-0.5 shrink-0 font-mono text-[0.6rem] uppercase tracking-wider text-sky/80">
                          {f.minutes} min
                        </span>
                      )}
                      <span className="font-sans text-[0.82rem] leading-snug text-bone/85">
                        {f.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {battlecard.objections?.length > 0 && (
              <div>
                <p className="mb-2 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-rust">
                  Objections and the right response
                </p>
                <ul className="flex flex-col gap-2.5">
                  {battlecard.objections.map((o, i) => (
                    <li
                      key={i}
                      className="rounded-xl border border-edge bg-ink/40 p-3"
                    >
                      <p className="font-sans text-[0.84rem] font-medium leading-snug text-bone">
                        {o.objection}
                      </p>
                      {o.response && (
                        <p className="mt-1 font-sans text-[0.82rem] leading-relaxed text-bone/80">
                          <span className="font-mono text-[0.52rem] uppercase tracking-wider text-sage">
                            say{" "}
                          </span>
                          {o.response}
                        </p>
                      )}
                      {o.haveReady && (
                        <p className="mt-1.5 rounded-lg border border-amber/40 bg-amber/10 px-2.5 py-1.5 font-sans text-[0.78rem] leading-snug text-amber">
                          <span className="font-mono text-[0.52rem] uppercase tracking-wider">
                            have ready{" "}
                          </span>
                          {o.haveReady}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {battlecard.doNotSay?.length > 0 && (
                <div className="rounded-xl border border-edge bg-ink/40 p-3">
                  <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-rust">
                    Do not say
                  </p>
                  <ul className="flex flex-col gap-1">
                    {battlecard.doNotSay.map((t, i) => (
                      <li
                        key={i}
                        className="flex gap-2 font-sans text-[0.8rem] leading-snug text-bone/85"
                      >
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rust/70" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {battlecard.questionsToAsk?.length > 0 && (
                <div className="rounded-xl border border-edge bg-ink/40 p-3">
                  <p className="mb-1.5 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-sky">
                    Questions to ask
                  </p>
                  <ul className="flex flex-col gap-1">
                    {battlecard.questionsToAsk.map((t, i) => (
                      <li
                        key={i}
                        className="flex gap-2 font-sans text-[0.8rem] leading-snug text-bone/85"
                      >
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-sky/70" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {battlecard.nextStep && (
              <div className="rounded-xl border border-sage/40 bg-sage/[0.06] p-3">
                <p className="mb-1 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-sage">
                  Next step to push for
                </p>
                <p className="font-sans text-[0.84rem] leading-snug text-bone/85">
                  {battlecard.nextStep}
                </p>
              </div>
            )}

            {battlecard.sources?.length > 0 && (
              <div>
                <p className="mb-1 font-mono text-[0.52rem] uppercase tracking-[0.18em] text-muted">
                  Researched from
                </p>
                <ul className="flex flex-col gap-0.5">
                  {battlecard.sources.map((s, i) => (
                    <li key={i} className="truncate">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[0.62rem] text-sky/80 transition hover:text-amber"
                      >
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* OPEN TO-DOS - the things you said you'd do for this client. */}
      {openTodos.length > 0 && (
        <section className="mb-6 rounded-xl border border-edge bg-panel/40 p-4">
          <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sage">
            ✓ Open to-dos
          </p>
          <ul className="flex flex-col gap-1.5">
            {openTodos.map((t, i) => (
              <li
                key={i}
                className="flex gap-2 font-sans text-[0.84rem] leading-snug text-bone/85"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sage/70" />
                {t}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* PLAYBOOK - the strategic plays to move this client forward. */}
      {playbook.length > 0 && (
        <section className="mb-6 rounded-xl border border-edge bg-panel/40 p-4">
          <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
            ♟ Playbook
          </p>
          <ol className="flex flex-col gap-1.5">
            {playbook.map((p, i) => (
              <li
                key={i}
                className="flex gap-2.5 font-sans text-[0.84rem] leading-snug text-bone/85"
              >
                <span className="font-mono text-[0.66rem] text-amber/80">
                  {i + 1}
                </span>
                {p}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* PREVIOUS CALL SUMMARIES - so you can sanity-check the intent against
          what actually happened, and catch anything the suggestion missed. */}
      <section>
        <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sky">
          ▦ Previous calls
        </p>

        {!calls.length ? (
          <p className="font-mono text-[0.66rem] leading-relaxed text-muted">
            {loaded
              ? "No call summaries on file for this client yet. Run a call and it will show up here for next time."
              : "Loading…"}
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {shownCalls.map((c) => {
                const s = c.summary || {};
                return (
                  <li
                    key={c.id}
                    className="rounded-xl border border-edge bg-panel/40 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[0.6rem] uppercase tracking-wider text-muted">
                        {fmtDate(c.created_at)}
                        {c.candidate ? ` · ${c.candidate}` : ""}
                      </span>
                      <div className="flex items-center gap-2">
                        {s.recommendation && (
                          <span className="rounded-full border border-amber/40 bg-amber/10 px-2.5 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider text-amber">
                            {s.recommendation}
                          </span>
                        )}
                        <Link
                          href={`/crm/calls/${c.id}`}
                          className="font-mono text-[0.56rem] uppercase tracking-wider text-sky transition hover:text-amber"
                        >
                          full scorecard ↗
                        </Link>
                      </div>
                    </div>

                    {s.headline && (
                      <p className="mt-2 font-sans text-[0.9rem] leading-snug text-bone">
                        {s.headline}
                      </p>
                    )}
                    {s.overview && (
                      <p className="mt-1 font-sans text-[0.82rem] leading-relaxed text-bone/70">
                        {s.overview}
                      </p>
                    )}

                    <Actions
                      title="→ You still owe"
                      items={list(s.myNextActions)}
                      tone="text-amber"
                    />
                    <Actions
                      title="They said they'd"
                      items={list(s.theirNextActions)}
                      tone="text-sky"
                    />
                    <Actions
                      title="Suggested next moves"
                      items={list(s.suggestedNextActions)}
                      tone="text-sage"
                    />
                    <Actions
                      title="Not covered"
                      items={list(s.notCovered)}
                      tone="text-muted"
                    />
                  </li>
                );
              })}
            </ul>
            {calls.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllCalls((v) => !v)}
                className="mt-3 w-full rounded-lg border border-edge px-3 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
              >
                {showAllCalls ? "show less" : `show all ${calls.length} calls`}
              </button>
            )}
          </>
        )}
      </section>

      <NavMenu />
    </main>
  );
}

export default function PrepPage() {
  return (
    <Suspense
      fallback={
        <main className="relative z-10 mx-auto max-w-[860px] px-5 py-10">
          <p className="font-mono text-[0.66rem] text-muted">Loading…</p>
        </main>
      }
    >
      <PrepInner />
    </Suspense>
  );
}
