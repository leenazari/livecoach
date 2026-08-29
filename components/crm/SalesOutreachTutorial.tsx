"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

type Step = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  checklist: string[];
  href: string | null;
  target: string | null;
};

export const SALES_OUTREACH_TUTORIAL_STEPS: Step[] = [
  {
    id: "overview",
    eyebrow: "Your safe sales flow",
    title: "From a fresh prospect to a truthful pipeline",
    body:
      "This walkthrough follows the real screens without changing data, running research or contacting anyone.",
    checklist: [
      "Choose the right campaign before selecting people",
      "Claim each prospect before research or outreach",
      "Move genuine interest into Pipeline with one clear next action",
    ],
    href: null,
    target: null,
  },
  {
    id: "campaign",
    eyebrow: "Step 1",
    title: "Check the campaign first",
    body:
      "A campaign answers who you are contacting and why. Open one campaign and check the amber Setup view before anyone builds a queue.",
    checklist: [
      "Confirm the goal, audience and Interviewa angle",
      "Check the daily maximum and whether the campaign is active",
      "Keep approval mode on so nothing sends unchecked",
    ],
    href: "/crm/outreach?tab=campaign",
    target: "campaign-setup",
  },
  {
    id: "campaign-sequence",
    eyebrow: "Step 2",
    title: "Build only the sequence you need",
    body:
      "New campaigns begin with one email. Open a campaign, choose the blue Sequence view and add a follow up only when it has a clear purpose.",
    checklist: [
      "Edit the first email before adding more steps",
      "Use Add next step for email, phone or manual LinkedIn activity",
      "Templates are optional and replace only the unsaved sequence",
      "Every email still waits for human approval",
    ],
    href: "/crm/outreach?tab=campaign",
    target: "campaign-sequence",
  },
  {
    id: "claim",
    eyebrow: "Step 3",
    title: "Claim suitable unassigned prospects",
    body:
      "Filter by campaign and choose Unassigned. Press Claim only when you intend to work that person.",
    checklist: [
      "Check the company and contact are relevant",
      "Claiming locks ownership to you",
      "Another salesperson cannot take the same claimed contact",
    ],
    href: "/crm/outreach?tab=prospects",
    target: "prospect-pool",
  },
  {
    id: "queue",
    eyebrow: "Step 4",
    title: "Build today’s ranked queue",
    body:
      "The Today view prioritises the strongest safe prospects within the active campaign. Work the limited queue instead of the whole database.",
    checklist: [
      "Start with the highest ranked people",
      "LiveCoach checks team wide email safety first",
      "Blocked, replied or duplicate recipients stay out",
    ],
    href: "/crm/outreach",
    target: "outreach-queue",
  },
  {
    id: "research",
    eyebrow: "Step 5",
    title: "Queue research and a first draft",
    body:
      "Research runs in the background only after you choose a prospect. You can continue working while LiveCoach prepares the draft.",
    checklist: [
      "Use Queue research and draft",
      "Researching never sends an email",
      "Read the evidence and relevance before approval",
    ],
    href: "/crm/outreach",
    target: "outreach-queue",
  },
  {
    id: "approval",
    eyebrow: "Step 6",
    title: "Approve the exact message",
    body:
      "Check the recipient, evidence, tone and offer. Only the exact words you approve can join your paced sending queue.",
    checklist: [
      "Correct anything vague or inaccurate",
      "Approve only when it sounds natural and relevant",
      "Sent emails are spaced and logged against your account",
    ],
    href: "/crm/outreach",
    target: "outreach-queue",
  },
  {
    id: "replies",
    eyebrow: "Step 7",
    title: "Turn positive replies into CRM context",
    body:
      "A reply stops the sequence. Review the reply, link it to the correct client, and prepare the next response or meeting.",
    checklist: [
      "Never guess a client match",
      "Link or create the right CRM profile",
      "Record the agreed next step and meeting",
    ],
    href: "/crm/outreach?tab=replies",
    target: "reply-handover",
  },
  {
    id: "pipeline",
    eyebrow: "Step 8",
    title: "Assign and advance the opportunity",
    body:
      "Pipeline becomes the source of truth once there is genuine commercial interest. Give the deal an owner, stage and dated next action.",
    checklist: [
      "Set the salesperson responsible for the deal",
      "Choose the lifecycle stage supported by the conversation",
      "Add one next action and due date. Leave value or outlook blank until evidence exists",
    ],
    href: "/crm/revenue",
    target: "pipeline-assignment",
  },
];

const API = "/api/crm/tutorial";

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The tutorial could not be updated");
  return data as TutorialResponse;
}

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
        return await readJson(
          await fetch(API, {
            method: "PUT",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status,
              currentStep: nextStep,
              lastPath: currentPath,
            }),
          })
        );
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
    void fetch(API, { cache: "no-store" })
      .then(readJson)
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
