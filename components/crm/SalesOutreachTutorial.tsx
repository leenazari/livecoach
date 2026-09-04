"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { crmFetch } from "@/lib/crm";
import { SALES_OUTREACH_TUTORIAL_STEPS } from "@/lib/sales-tutorial";

type TutorialStatus =
  | "not_started"
  | "active"
  | "paused"
  | "completed"
  | "dismissed";

type TutorialResponse = {
  tutorial: {
    status: TutorialStatus;
    currentStep: number;
    lastPath: string | null;
  };
  autoStart: boolean;
  role: "owner" | "manager" | "sales";
};

type SetupCheck = {
  id: string;
  label: string;
  state: "ready" | "action";
  detail: string;
  href?: string;
  actionLabel?: string;
};

type AccountReadinessResponse = {
  account: {
    readyCount: number;
    totalCount: number;
    checks: SetupCheck[];
  };
  capabilities: {
    linkedinAutomation?: {
      available: boolean;
      connected: boolean;
      webhookConfigured: boolean;
      mappedCampaignCount: number;
      outboundReady: boolean;
    };
  };
  aiUsed: false;
};

const CORE_SETUP_IDS = new Set([
  "account",
  "sales_profile",
  "email",
  "calendar",
  "linkedin",
  "transcriber",
  "leads",
  "privacy",
]);

const API = "/api/crm/tutorial";

export default function SalesOutreachTutorial() {
  const pathname = usePathname() || "/crm";
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [readiness, setReadiness] = useState<AccountReadinessResponse | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState("");
  const initialLoadRef = useRef(false);

  const currentPath = useMemo(() => {
    const query = searchParams.toString();
    return `${pathname}${query ? `?${query}` : ""}`;
  }, [pathname, searchParams]);
  const step = SALES_OUTREACH_TUTORIAL_STEPS[currentStep];

  const loadSetup = useCallback(async () => {
    setSetupLoading(true);
    setSetupError("");
    try {
      setReadiness(
        await crmFetch<AccountReadinessResponse>("/api/crm/account-readiness")
      );
    } catch (nextError: any) {
      setSetupError(nextError?.message || "Your setup checks could not refresh");
    } finally {
      setSetupLoading(false);
    }
  }, []);

  const writeProgress = useCallback(
    async (status: Exclude<TutorialStatus, "not_started">, nextStep: number) => {
      setSaving(true);
      setError("");
      try {
        return await crmFetch<TutorialResponse>(API, {
          method: "PUT",
          body: JSON.stringify({
            status,
            currentStep: nextStep,
            lastPath: currentPath,
          }),
        });
      } catch (nextError: any) {
        setError(nextError?.message || "Your tutorial progress was not saved");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [currentPath]
  );

  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    let active = true;
    void crmFetch<TutorialResponse>(API)
      .then((data) => {
        if (!active) return;
        const savedStep = Math.min(
          SALES_OUTREACH_TUTORIAL_STEPS.length - 1,
          Math.max(0, Number(data.tutorial.currentStep) || 0)
        );
        setCurrentStep(savedStep);
        if (data.tutorial.status === "active" || data.autoStart) {
          setOpen(true);
          void loadSetup();
          if (data.autoStart) void writeProgress("active", 0);
        }
      })
      .catch(() => {
        // The CRM remains fully usable if this optional guide is unavailable.
      })
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [loadSetup, writeProgress]);

  useEffect(() => {
    const start = (event: Event) => {
      const requestedStepId = (event as CustomEvent<{ stepId?: string }>).detail?.stepId;
      const requestedStep = requestedStepId
        ? SALES_OUTREACH_TUTORIAL_STEPS.findIndex((item) => item.id === requestedStepId)
        : 0;
      const nextStep = requestedStep >= 0 ? requestedStep : 0;
      setCurrentStep(nextStep);
      setConfirmDismiss(false);
      setError("");
      setOpen(true);
      void loadSetup();
      void writeProgress("active", nextStep);
    };
    window.addEventListener("lc:start-sales-tutorial", start);
    return () => window.removeEventListener("lc:start-sales-tutorial", start);
  }, [loadSetup, writeProgress]);

  useEffect(() => {
    const refreshAfterReturn = () => {
      if (open && currentStep <= 1) void loadSetup();
    };
    window.addEventListener("focus", refreshAfterReturn);
    return () => window.removeEventListener("focus", refreshAfterReturn);
  }, [currentStep, loadSetup, open]);

  const onStepScreen = useMemo(() => {
    if (!step.href) return true;
    const expected = new URL(step.href, "https://livecoach.local");
    if (pathname !== expected.pathname) return false;
    const expectedTab = expected.searchParams.get("tab");
    const actualTab = searchParams.get("tab") || "queue";
    return expectedTab ? actualTab === expectedTab : actualTab === "queue";
  }, [pathname, searchParams, step.href]);

  useEffect(() => {
    if (!open || !onStepScreen || !step.target) return;
    let target: HTMLElement | null = null;
    let attempts = 0;
    const findTarget = () => {
      target = document.querySelector<HTMLElement>(
        `[data-sales-tour="${step.target}"]`
      );
      attempts += 1;
      if (!target) return;
      target.setAttribute("data-sales-tour-active", "true");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      window.clearInterval(timer);
    };
    const timer = window.setInterval(() => {
      findTarget();
      if (attempts >= 20) window.clearInterval(timer);
    }, 250);
    findTarget();
    return () => {
      window.clearInterval(timer);
      target?.removeAttribute("data-sales-tour-active");
    };
  }, [onStepScreen, open, step.target]);

  const moveTo = async (nextStep: number) => {
    const bounded = Math.min(
      SALES_OUTREACH_TUTORIAL_STEPS.length - 1,
      Math.max(0, nextStep)
    );
    const previousStep = currentStep;
    setCurrentStep(bounded);
    const saved = await writeProgress("active", bounded);
    if (!saved) {
      setCurrentStep(previousStep);
      return;
    }
    const nextPath = SALES_OUTREACH_TUTORIAL_STEPS[bounded].href;
    if (nextPath) router.push(nextPath);
  };

  const pause = async () => {
    const saved = await writeProgress("paused", currentStep);
    if (saved) setOpen(false);
  };

  const dismiss = async () => {
    const saved = await writeProgress("dismissed", currentStep);
    if (saved) {
      setConfirmDismiss(false);
      setOpen(false);
    }
  };

  const finish = async () => {
    const saved = await writeProgress(
      "completed",
      SALES_OUTREACH_TUTORIAL_STEPS.length - 1
    );
    if (saved) setOpen(false);
  };

  const openCurrentScreen = () => {
    if (step.href) router.push(step.href);
  };

  const coreChecks = (readiness?.account.checks || []).filter((check) =>
    CORE_SETUP_IDS.has(check.id)
  );
  const missingChecks = coreChecks.filter((check) => check.state === "action");
  const readyChecks = coreChecks.filter((check) => check.state === "ready");
  const setupKnown = coreChecks.length > 0;
  const coreSetupReady = setupKnown && missingChecks.length === 0;
  const linkedInAutomation = readiness?.capabilities.linkedinAutomation;
  const automationDetail = !linkedInAutomation?.available
    ? "LinkedIn automation is not available on this deployment yet."
    : !linkedInAutomation.connected
      ? "Connect this salesperson's own SendPilot account if they will use LinkedIn automation."
      : !linkedInAutomation.webhookConfigured
        ? "SendPilot is connected. Add this user's webhook secret so replies return to LiveCoach."
        : linkedInAutomation.mappedCampaignCount < 1
          ? "SendPilot and replies are connected. Map one active campaign before handing off leads."
          : `${linkedInAutomation.mappedCampaignCount} LinkedIn campaign${linkedInAutomation.mappedCampaignCount === 1 ? " is" : "s are"} mapped and ready.`;

  if (!loaded || !open) return null;

  const percent = Math.round(
    ((currentStep + 1) / SALES_OUTREACH_TUTORIAL_STEPS.length) * 100
  );
  const finalStep = currentStep === SALES_OUTREACH_TUTORIAL_STEPS.length - 1;
  const primaryLabel =
    currentStep === 0
      ? coreSetupReady
        ? "Start walkthrough"
        : "Review setup"
      : !onStepScreen
        ? "Open this screen"
        : finalStep
          ? "Finish tutorial"
          : "Next step";

  return (
    <aside
      role="dialog"
      aria-label="Sales outreach tutorial"
      className="fixed inset-x-3 bottom-[5.2rem] z-[70] max-h-[min(72vh,620px)] overflow-y-auto rounded-2xl border border-amber/45 bg-panel/95 p-4 shadow-2xl backdrop-blur sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[390px]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[0.54rem] uppercase tracking-[0.18em] text-amber">
            Sales tutorial · {currentStep + 1} of {SALES_OUTREACH_TUTORIAL_STEPS.length}
          </p>
          <p className="mt-1 text-xs text-muted">{percent}% complete</p>
        </div>
        <button
          type="button"
          onClick={pause}
          disabled={saving}
          className="min-h-9 rounded-lg px-2 font-mono text-[0.52rem] uppercase text-muted hover:text-bone disabled:opacity-40"
        >
          Pause
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink">
        <div
          className="h-full rounded-full bg-amber transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      {currentStep <= 1 ? (
        <section className="mt-4 rounded-xl border border-sage/35 bg-sage/[0.05] p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-sage">
                Your live setup
              </p>
              <p className="mt-1 text-sm font-semibold text-bone">
                {setupLoading && !setupKnown
                  ? "Checking this account…"
                  : coreSetupReady
                    ? "Ready to start selling"
                    : `${readyChecks.length} of ${coreChecks.length || 8} core checks ready`}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">
                Checked from this login only. No AI tokens are used.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadSetup()}
              disabled={setupLoading}
              className="min-h-9 shrink-0 rounded-lg border border-sage/35 px-2 font-mono text-[0.48rem] uppercase text-sage disabled:opacity-40"
            >
              {setupLoading ? "Checking…" : "Refresh"}
            </button>
          </div>

          {setupError ? (
            <p className="mt-3 rounded-lg border border-rust/40 bg-rust/10 px-3 py-2 text-xs text-rust">
              {setupError}
            </p>
          ) : null}

          {missingChecks.length ? (
            <div className="mt-3 space-y-2">
              {missingChecks.map((check, index) => (
                <div key={check.id} className="rounded-lg border border-amber/30 bg-ink/35 p-2.5">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-amber">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-bone">{check.label}</p>
                      <p className="mt-1 text-[0.68rem] leading-4 text-muted">{check.detail}</p>
                      {check.href ? (
                        <button
                          type="button"
                          onClick={() => router.push(check.href!)}
                          className="mt-2 min-h-8 rounded-full border border-amber/40 px-3 font-mono text-[0.46rem] uppercase text-amber"
                        >
                          {check.actionLabel || "Complete this"} →
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : setupKnown ? (
            <p className="mt-3 rounded-lg border border-sage/30 bg-sage/[0.06] px-3 py-2 text-xs text-sage">
              ✓ Email, calendar, identity, leads, privacy and call setup are ready.
            </p>
          ) : null}

          {readyChecks.length ? (
            <details className="mt-3 rounded-lg border border-edge bg-ink/25 px-3 py-2">
              <summary className="cursor-pointer font-mono text-[0.48rem] uppercase tracking-wider text-muted">
                Already ready · {readyChecks.length}
              </summary>
              <ul className="mt-2 space-y-1.5 text-xs text-sage">
                {readyChecks.map((check) => (
                  <li key={check.id}>✓ {check.label}</li>
                ))}
              </ul>
            </details>
          ) : null}

          {linkedInAutomation ? (
            <div className={`mt-3 rounded-lg border px-3 py-2 ${linkedInAutomation.outboundReady ? "border-sage/30 bg-sage/[0.05]" : "border-sky/30 bg-sky/[0.05]"}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-bone">LinkedIn automation</p>
                <span className={`font-mono text-[0.44rem] uppercase ${linkedInAutomation.outboundReady ? "text-sage" : "text-sky"}`}>
                  {linkedInAutomation.outboundReady ? "Ready" : "Optional"}
                </span>
              </div>
              <p className="mt-1 text-[0.68rem] leading-4 text-muted">{automationDetail}</p>
              {!linkedInAutomation.outboundReady && linkedInAutomation.available ? (
                <button
                  type="button"
                  onClick={() => router.push("/settings#sendpilot-inbox")}
                  className="mt-2 min-h-8 rounded-full border border-sky/40 px-3 font-mono text-[0.46rem] uppercase text-sky"
                >
                  Open SendPilot setup →
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="mt-4">
        <p className="font-mono text-[0.55rem] uppercase tracking-wider text-sage">
          {step.eyebrow}
        </p>
        <h2 className="mt-1 font-display text-xl leading-tight text-bone">
          {step.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-bone/75">{step.body}</p>
        <section
          aria-label={`Practice example for ${step.title}`}
          className="mt-3 rounded-xl border border-sky/35 bg-sky/[0.06] p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[0.5rem] uppercase tracking-[0.16em] text-sky">
              {step.demo.label}
            </p>
            <span className="rounded-full border border-sky/35 px-2 py-0.5 font-mono text-[0.46rem] uppercase text-sky">
              Preview only
            </span>
          </div>
          <h3 className="mt-2 text-sm font-semibold text-bone">
            {step.demo.title}
          </h3>
          <ul className="mt-2 space-y-1.5 text-xs leading-5 text-bone/75">
            {step.demo.facts.map((fact) => (
              <li key={fact} className="flex gap-2">
                <span className="text-sky">•</span>
                <span>{fact}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-sky/20 pt-2 text-xs leading-5 text-sage">
            {step.demo.outcome}
          </p>
        </section>
        <ul className="mt-3 space-y-2 text-sm leading-5 text-bone/80">
          {step.checklist.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-0.5 text-moss">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        {currentStep > 0 && onStepScreen ? (
          <p className="mt-3 rounded-lg border border-amber/25 bg-amber/[0.06] px-3 py-2 text-xs leading-5 text-amber">
            Use the highlighted area on this screen, then continue when you are ready.
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-lg border border-rust/45 bg-rust/10 px-3 py-2 text-xs text-rust" role="status">
            {error}
          </p>
        ) : null}
      </div>

      {confirmDismiss ? (
        <div className="mt-4 rounded-xl border border-rust/40 bg-rust/[0.08] p-3">
          <p className="text-sm text-bone">Turn off the automatic tutorial?</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            You can restart it at any time from More tools.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setConfirmDismiss(false)}
              className="min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.52rem] uppercase text-bone"
            >
              Keep tutorial
            </button>
            <button
              type="button"
              onClick={dismiss}
              disabled={saving}
              className="min-h-10 rounded-lg border border-rust/60 bg-rust/10 px-3 font-mono text-[0.52rem] uppercase text-rust disabled:opacity-40"
            >
              Turn off
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 flex gap-2">
            {currentStep > 0 ? (
              <button
                type="button"
                onClick={() => moveTo(currentStep - 1)}
                disabled={saving}
                className="min-h-11 rounded-lg border border-edge px-3 font-mono text-[0.55rem] uppercase text-bone disabled:opacity-40"
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (currentStep === 0) void moveTo(coreSetupReady ? 2 : 1);
                else if (!onStepScreen) openCurrentScreen();
                else if (finalStep) void finish();
                else void moveTo(currentStep + 1);
              }}
              disabled={saving}
              className="min-h-11 flex-1 rounded-lg border border-amber/60 bg-amber/15 px-4 font-mono text-[0.57rem] uppercase tracking-wider text-amber disabled:opacity-40"
            >
              {saving ? "Saving…" : primaryLabel}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setConfirmDismiss(true)}
            className="mt-3 w-full min-h-9 font-mono text-[0.5rem] uppercase tracking-wider text-muted hover:text-rust"
          >
            Turn off tutorial
          </button>
        </>
      )}
    </aside>
  );
}
