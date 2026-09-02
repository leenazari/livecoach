"use client";

import {
  FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import CompanyLinkPicker from "@/components/crm/CompanyLinkPicker";
import { crmFetch } from "@/lib/crm";
import {
  foldDictationEvent,
  stabiliseLiveDictationPreview,
} from "@/lib/dictation";
import {
  followUpAtFromLocalParts,
  followUpAtIsPast,
  localDateInputValue,
} from "@/lib/follow-up-scheduling";

type TaskAction = "task" | "call" | "email";

export type TaskComposerCompany = {
  id: string;
  name: string;
};

export type TaskComposerProspect = {
  id: string;
  name: string;
  companyName?: string | null;
};

export type TaskComposerResult = {
  ok: boolean;
  created: boolean;
  alreadyExists: boolean;
  task: {
    id: string;
    company_id: string | null;
    text: string;
    link_kind: string | null;
    due_at: string | null;
  };
};

const input =
  "w-full rounded-lg border border-edge bg-ink/60 px-3 py-2.5 text-sm text-bone outline-none placeholder:text-muted/55 focus:border-amber/60";

export default function TaskComposer({
  fixedCompany = null,
  prospect = null,
  defaultText = "",
  initiallyOpen = false,
  triggerLabel = "Log a task",
  onSaved,
  onCancel,
}: {
  fixedCompany?: TaskComposerCompany | null;
  prospect?: TaskComposerProspect | null;
  defaultText?: string;
  initiallyOpen?: boolean;
  triggerLabel?: string;
  onSaved?: (result: TaskComposerResult) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [text, setText] = useState(defaultText);
  const [action, setAction] = useState<TaskAction>("task");
  const [company, setCompany] = useState<TaskComposerCompany | null>(
    fixedCompany
  );
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [pinned, setPinned] = useState(false);
  const [listening, setListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestIdRef = useRef("");
  const recognitionRef = useRef<any>(null);
  const keepListeningRef = useRef(false);
  const textRef = useRef(defaultText);
  const dictationBaseRef = useRef("");
  const dictationPreviewRef = useRef("");
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const textInputId = useId();
  const minimumDate = useMemo(() => localDateInputValue(), []);

  useEffect(() => {
    textRef.current = text;
    if (listening && textAreaRef.current) {
      textAreaRef.current.scrollTop = textAreaRef.current.scrollHeight;
    }
  }, [listening, text]);

  useEffect(
    () => () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Recognition may already have ended.
      }
    },
    []
  );

  const stopVoice = () => {
    keepListeningRef.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setListening(false);
    try {
      recognition?.stop();
    } catch {
      // Recognition may already have ended.
    }
  };

  const startVoice = () => {
    const SpeechRecognition =
      (window as any).webkitSpeechRecognition ||
      (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice input needs Chrome, Edge or another Chromium browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-GB";
    recognition.interimResults = true;
    recognition.continuous = true;
    dictationBaseRef.current = textRef.current.trim()
      ? `${textRef.current.trim()} `
      : "";
    dictationPreviewRef.current = textRef.current.trim();
    let committed = "";

    recognition.onresult = (event: any) => {
      const folded = foldDictationEvent(committed, event.results);
      committed = folded.committed;
      let hasNewFinal = false;
      for (let index = 0; index < (event.results?.length || 0); index += 1) {
        if (event.results[index]?.isFinal) hasNewFinal = true;
      }
      const combined = `${dictationBaseRef.current}${folded.text}`.trim();
      const stable = stabiliseLiveDictationPreview(
        dictationPreviewRef.current,
        combined,
        hasNewFinal
      );
      dictationPreviewRef.current = stable;
      setText(stable);
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
        if (keepListeningRef.current) {
          // Mobile browsers sometimes end recognition during a thinking pause.
          // Keep the task mic open until the user deliberately taps Stop.
          window.setTimeout(() => {
            if (keepListeningRef.current && !recognitionRef.current) {
              startVoice();
            }
          }, 100);
        } else {
          setListening(false);
        }
      }
    };
    recognition.onerror = (event: any) => {
      if (event?.error === "aborted" || event?.error === "no-speech") {
        return;
      }
      keepListeningRef.current = false;
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
      setListening(false);
      setError("I could not hear that clearly. Tap the microphone and try again.");
    };

    recognitionRef.current = recognition;
    keepListeningRef.current = true;
    setError("");
    setListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      keepListeningRef.current = false;
      setListening(false);
      setError("The microphone could not start. Tap it once more to try again.");
    }
  };

  const toggleVoice = () => {
    if (recognitionRef.current || listening) {
      stopVoice();
      return;
    }
    startVoice();
  };

  const close = () => {
    stopVoice();
    setOpen(false);
    setError("");
    onCancel?.();
  };

  const changeAction = (next: TaskAction) => {
    setAction(next);
    setError("");
    if (next === "call" && !dueTime) setDueTime("09:00");
  };

  const resetForAnother = () => {
    stopVoice();
    setText(defaultText);
    setAction("task");
    setCompany(fixedCompany);
    setDueDate("");
    setDueTime("");
    setPinned(false);
    requestIdRef.current = "";
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const taskText = text.trim();
    if (taskText.length < 3) {
      setError("Add what needs to be done.");
      return;
    }
    if (dueTime && !dueDate) {
      setError("Choose a due date for that time.");
      return;
    }
    if (action === "call" && (!dueDate || !dueTime)) {
      setError("Call and follow-up tasks need a due date and time so they appear correctly in Calls.");
      return;
    }
    if (action === "email" && !company && !prospect) {
      setError("Choose the client or prospect this email task is for.");
      return;
    }

    const dueAt = dueDate
      ? dueTime
        ? followUpAtFromLocalParts(dueDate, dueTime)
        : dueDate
      : null;
    if (dueDate && !dueAt) {
      setError("Choose a valid due date and time.");
      return;
    }
    if (dueAt && dueTime && followUpAtIsPast(dueAt)) {
      setError("Choose a due time that has not already passed.");
      return;
    }

    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<TaskComposerResult>("/api/crm/tasks", {
        method: "POST",
        body: JSON.stringify({
          requestId: requestIdRef.current,
          text: taskText,
          action,
          companyId: company?.id || null,
          outreachProspectId: prospect?.id || null,
          dueAt,
          pinned,
        }),
      });
      if (!result.ok || !result.task?.id) {
        throw new Error("LiveCoach did not confirm that the task was saved");
      }
      window.dispatchEvent(
        new CustomEvent("lc:tasks-updated", {
          detail: { source: "task-composer", taskId: result.task.id },
        })
      );
      window.dispatchEvent(new CustomEvent("lc:crm-updated"));
      setNotice(
        result.created
          ? company && !result.task.company_id
            ? "Task saved with the prospect, but the old CRM client link was not available to your account."
            : action === "call"
              ? "Task saved in Today, To-dos and Calls."
              : "Task saved in Today and To-dos."
          : "That open task already exists, so LiveCoach did not duplicate it."
      );
      resetForAnother();
      setOpen(false);
      await onSaved?.(result);
    } catch (caught: any) {
      setError(caught?.message || "That task did not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setNotice("");
          }}
          className="min-h-10 rounded-lg border border-amber/55 bg-amber/10 px-3 font-mono text-[0.56rem] uppercase tracking-wider text-amber transition hover:bg-amber/20"
        >
          ＋ {triggerLabel}
        </button>
        {notice ? (
          <p role="status" className="text-xs leading-5 text-moss">
            {notice}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={save}
      className="mb-3 rounded-xl border border-amber/45 bg-amber/[0.055] p-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[0.55rem] uppercase tracking-wider text-amber">
            Log a task
          </p>
          <p className="mt-1 text-xs leading-5 text-muted">
            Add the action, type, client, timing and priority here. It stays private to your own work list.
          </p>
          {prospect ? (
            <p className="mt-1 text-xs text-sky">
              For {prospect.name || prospect.companyName || "this prospect"}
              {prospect.companyName && prospect.name
                ? ` at ${prospect.companyName}`
                : ""}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={close}
          disabled={saving}
          className="min-h-9 px-2 font-mono text-[0.54rem] uppercase text-muted disabled:opacity-40"
        >
          Close
        </button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(10rem,.65fr)]">
        <div>
          <label
            htmlFor={textInputId}
            className="mb-1 block font-mono text-[0.52rem] uppercase text-muted"
          >
            What needs to be done
          </label>
          <div className="flex items-stretch gap-2">
            <textarea
              id={textInputId}
              ref={textAreaRef}
              autoFocus
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setError("");
              }}
              rows={listening ? 4 : 2}
              maxLength={500}
              placeholder={
                listening
                  ? "Listening… say the task in your own words"
                  : "Type the task, or tap the microphone and speak"
              }
              className={`${input} resize-y leading-5 ${
                listening ? "min-h-[108px] border-rust/65" : "min-h-[68px]"
              }`}
            />
            <button
              type="button"
              onClick={toggleVoice}
              disabled={saving}
              aria-label={listening ? "Stop task dictation" : "Speak task"}
              aria-pressed={listening}
              title={listening ? "Stop listening" : "Speak this task"}
              className={`flex min-w-12 items-center justify-center gap-2 rounded-lg border px-3 font-mono text-[0.58rem] uppercase tracking-wider transition disabled:opacity-40 ${
                listening
                  ? "border-rust bg-rust/15 text-rust"
                  : "border-amber/50 bg-amber/10 text-amber hover:bg-amber/20"
              }`}
            >
              <span aria-hidden="true">{listening ? "■" : "🎤"}</span>
              <span className="hidden sm:inline">
                {listening ? "Stop" : "Speak"}
              </span>
            </button>
          </div>
          <span
            aria-live="polite"
            className={`mt-1 block min-h-4 text-xs ${
              listening ? "text-rust" : "text-muted"
            }`}
          >
            {listening
              ? "Listening. Your words stay visible here. Tap stop when finished."
              : "Use the microphone to dictate, then edit anything before saving."}
          </span>
        </div>
        <label>
          <span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">
            Task type
          </span>
          <select
            value={action}
            onChange={(event) => changeAction(event.target.value as TaskAction)}
            className={input}
          >
            <option value="task">General task</option>
            <option value="call">Call or follow-up</option>
            <option value="email">Email</option>
          </select>
        </label>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(9rem,.55fr)_minmax(8rem,.5fr)]">
        <div>
          <span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">
            {prospect ? "Client and prospect context" : "Client context, optional"}
          </span>
          {fixedCompany ? (
            <div className="flex min-h-10 items-center gap-2 rounded-lg border border-sky/35 bg-sky/[0.06] px-3 text-sm text-sky">
              <span aria-hidden="true">◆</span>
              <span>{fixedCompany.name}</span>
              <span className="ml-auto font-mono text-[0.48rem] uppercase text-muted">
                fixed to this record
              </span>
            </div>
          ) : (
            <CompanyLinkPicker
              value={company}
              onChange={setCompany}
              allowCreate={false}
              placeholder="Find an existing client or leave unlinked…"
              createContext="task"
            />
          )}
        </div>
        <label>
          <span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">
            Due date
          </span>
          <input
            type="date"
            min={minimumDate}
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className={input}
          />
        </label>
        <label>
          <span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">
            Due time
          </span>
          <input
            type="time"
            value={dueTime}
            onChange={(event) => setDueTime(event.target.value)}
            className={input}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-bone/80">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => setPinned(event.target.checked)}
            className="h-4 w-4 accent-amber"
          />
          Keep at the top as a priority
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="min-h-10 rounded-lg border border-edge px-4 font-mono text-[0.56rem] uppercase text-muted disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || text.trim().length < 3}
            className="min-h-10 rounded-lg border border-amber/60 bg-amber/15 px-4 font-mono text-[0.56rem] uppercase text-amber transition hover:bg-amber/20 disabled:opacity-40"
          >
            {saving ? "Saving task…" : "Save task"}
          </button>
        </div>
      </div>
      {action === "call" ? (
        <p className="mt-2 text-xs leading-5 text-sky">
          Call and follow-up tasks also appear in Calls at the chosen date and time.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm leading-5 text-rust">
          {error}
        </p>
      ) : null}
    </form>
  );
}
