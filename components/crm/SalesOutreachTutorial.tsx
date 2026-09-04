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
  const initialLoadRef = useRef(false);

  const currentPath = useMemo(() => {
    const query = searchParams.toString();
    return `${pathname}${query ? `?${query}` : ""}`;
  }, [pathname, searchParams]);
  const step = SALES_OUTREACH_TUTORIAL_STEPS[currentStep];

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
  }, [writeProgress]);

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
      void writeProgress("active", nextStep);
    };
    window.addEventListener("lc:start-sales-tutorial", start);
    return () => window.removeEventListener("lc:start-sales-tutorial", start);
  }, [writeProgress]);

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

  if (!loaded || !open) return null;

  const percent = Math.round(
    ((currentStep + 1) / SALES_OUTREACH_TUTORIAL_STEPS.length) * 100
  );
  const finalStep = currentStep === SALES_OUTREACH_TUTORIAL_STEPS.length - 1;
  const primaryLabel =
    currentStep === 0
      ? "Start walkthrough"
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
                if (currentStep === 0) void moveTo(1);
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
