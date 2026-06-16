"use client";

import { useEffect, useRef, useState } from "react";
import { crmFetch } from "@/lib/crm";
import { extractDocText } from "@/lib/extract-doc";
import { foldDictationEvent } from "@/lib/dictation";

type Item = {
  id: string;
  kind: "note" | "link" | "doc";
  title: string | null;
  url: string | null;
  content: string | null;
  created_at: string;
};

const fmtUpdated = (iso: string | null) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

// A company-scoped context store: add notes, links, or documents that augment a
// client beyond its calls (things prepped separately, or jotted after an
// off-system call). Everything here feeds the assistant and the next call's plan.
export default function ClientContext({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [tab, setTab] = useState<"note" | "link" | "doc">("note");
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // A running summary of the email thread so far - a dedicated company field
  // (not a context item), because the relationship is happening over email.
  const [emailCtx, setEmailCtx] = useState("");
  const [emailUpdatedAt, setEmailUpdatedAt] = useState<string | null>(null);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [eListening, setEListening] = useState(false);
  const eRecRef = useRef<any>(null);
  const eBaseRef = useRef("");
  const emailRef = useRef("");
  useEffect(() => {
    emailRef.current = emailCtx;
  }, [emailCtx]);

  const load = () =>
    crmFetch<{ items: Item[] }>(`/api/crm/companies/${companyId}/context`)
      .then((d) => setItems(d.items || []))
      .catch(() => {});

  useEffect(() => {
    load();
    crmFetch<{
      company: {
        email_context: string | null;
        email_context_updated_at: string | null;
      };
    }>(`/api/crm/companies/${companyId}`)
      .then((d) => {
        setEmailCtx(d.company?.email_context || "");
        setEmailUpdatedAt(d.company?.email_context_updated_at || null);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const saveEmail = async () => {
    setEmailSaving(true);
    try {
      await crmFetch(`/api/crm/companies/${companyId}`, {
        method: "PATCH",
        body: JSON.stringify({ email_context: emailCtx }),
      });
      setEmailUpdatedAt(new Date().toISOString());
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 2500);
    } catch {
      /* ignore */
    } finally {
      setEmailSaving(false);
    }
  };

  const toggleEmailMic = () => {
    const SR =
      (window as any).webkitSpeechRecognition ||
      (window as any).SpeechRecognition;
    if (!SR) {
      alert("Voice input needs a Chromium browser (Chrome, Edge, Arc).");
      return;
    }
    if (eRecRef.current) {
      try {
        eRecRef.current.stop();
      } catch {
        /* ignore */
      }
      return;
    }
    const rec = new SR();
    rec.lang = "en-GB";
    rec.interimResults = true;
    rec.continuous = true;
    eBaseRef.current = emailRef.current.trim()
      ? `${emailRef.current.trim()} `
      : "";
    let committed = "";
    rec.onresult = (e: any) => {
      // Shared merge: handles desktop segments AND Android's cumulative
      // restatement (no "sosososo" runaway).
      const r = foldDictationEvent(committed, e.results);
      committed = r.committed;
      setEmailCtx((eBaseRef.current + r.text).trim());
    };
    rec.onend = () => {
      setEListening(false);
      eRecRef.current = null;
    };
    rec.onerror = () => setEListening(false);
    eRecRef.current = rec;
    setEListening(true);
    rec.start();
  };

  const add = async (body: Record<string, any>) => {
    setBusy(true);
    setErr("");
    try {
      await crmFetch(`/api/crm/companies/${companyId}/context`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setNote("");
      setTitle("");
      setUrl("");
      setProgress("");
      load();
    } catch (e: any) {
      setErr(e.message || "could not add that");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setErr("");
    try {
      const text = await extractDocText(f, setProgress);
      if (!text.trim()) throw new Error("couldn't read any text from that file");
      await add({ kind: "doc", title: f.name, content: text });
    } catch (e: any) {
      setErr(e.message || "could not read that file");
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setItems((p) => p.filter((x) => x.id !== id));
    crmFetch(`/api/crm/context/${id}`, { method: "DELETE" }).catch(() => {});
  };

  const tabCls = (t: string) =>
    `rounded-full px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider transition ${
      tab === t
        ? "border border-amber/60 bg-amber/15 text-amber"
        : "border border-edge text-muted hover:text-bone"
    }`;

  return (
    <div className="flex flex-col gap-4">
    <section className="rounded-xl border border-sky/40 bg-sky/[0.05] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sky">
          {"✉"} Email context{" "}
          <span className="text-muted">- the email thread so far, shapes the plan &amp; intent</span>
        </p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[0.52rem] tracking-wider text-muted">
            {emailUpdatedAt ? `updated ${fmtUpdated(emailUpdatedAt)}` : "not set yet"}
          </span>
          {emailSaved && (
            <span className="font-mono text-[0.54rem] uppercase tracking-wider text-sage">
              saved ✓
            </span>
          )}
          <button
            type="button"
            onClick={toggleEmailMic}
            title={eListening ? "tap to stop" : "speak the email summary"}
            className={`flex h-7 w-7 items-center justify-center rounded-full border text-[0.8rem] transition ${
              eListening
                ? "border-rust bg-rust text-white"
                : "border-sky/60 bg-sky/15 text-sky hover:bg-sky/25"
            }`}
          >
            {eListening ? "⏹" : "\u{1F3A4}"}
          </button>
        </div>
      </div>
      <textarea
        value={emailCtx}
        onChange={(e) => setEmailCtx(e.target.value)}
        rows={5}
        placeholder="Summarise the email thread so far - what they've said, where it's up to, what's outstanding. The AI weighs this heavily for the plan, intent and next steps."
        className="w-full resize-y rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-sky/60"
      />
      <button
        type="button"
        onClick={saveEmail}
        disabled={emailSaving}
        className="mt-2 rounded-full border border-sky/60 bg-sky/15 px-4 py-1.5 font-mono text-[0.6rem] uppercase tracking-wider text-sky transition hover:bg-sky/25 disabled:opacity-40"
      >
        {emailSaving ? "saving…" : "save email context"}
      </button>
    </section>

    <section className="rounded-xl border border-edge bg-panel/40 p-4">
      <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
        Context{" "}
        <span className="text-muted">- notes, links &amp; docs that feed the plan</span>
      </p>

      <div className="mb-2.5 flex gap-2">
        <button type="button" onClick={() => setTab("note")} className={tabCls("note")}>note</button>
        <button type="button" onClick={() => setTab("link")} className={tabCls("link")}>link</button>
        <button type="button" onClick={() => setTab("doc")} className={tabCls("doc")}>document</button>
      </div>

      {tab === "note" && (
        <div className="flex flex-col gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Anything to remember - e.g. 'Alaine said on the phone she wants to launch by Q3'."
            className="w-full resize-y rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none focus:border-amber/60"
          />
          <button
            type="button"
            onClick={() => note.trim() && add({ kind: "note", content: note.trim() })}
            disabled={busy || !note.trim()}
            className="self-start rounded-full border border-amber/60 bg-amber/15 px-4 py-1.5 font-mono text-[0.6rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
          >
            add note
          </button>
        </div>
      )}

      {tab === "link" && (
        <div className="flex flex-col gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… (we read the page text)"
            className="w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none focus:border-amber/60"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Label (optional)"
            className="w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none focus:border-amber/60"
          />
          <button
            type="button"
            onClick={() => url.trim() && add({ kind: "link", url: url.trim(), title: title.trim() })}
            disabled={busy || !url.trim()}
            className="self-start rounded-full border border-amber/60 bg-amber/15 px-4 py-1.5 font-mono text-[0.6rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
          >
            {busy ? "reading…" : "add link"}
          </button>
        </div>
      )}

      {tab === "doc" && (
        <div
          onClick={() => !busy && fileRef.current?.click()}
          className="cursor-pointer rounded-lg border border-dashed border-edge bg-ink/40 px-4 py-4 text-center transition hover:border-amber/50"
        >
          <p className="font-mono text-[0.62rem] uppercase tracking-wider text-bone">
            {busy ? progress || "reading…" : "click to add a document"}
          </p>
          <p className="mt-1 font-mono text-[0.55rem] text-muted">
            PDF, Word or text. Read in your browser, any size.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.csv,application/pdf"
            className="hidden"
            onChange={onFile}
          />
        </div>
      )}

      {err && <p className="mt-2 font-mono text-[0.58rem] text-rust">{err}</p>}

      {items.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-edge bg-ink/40 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-sans text-[0.82rem] text-bone">
                  <span className="mr-2 font-mono text-[0.54rem] uppercase tracking-wider text-amber/70">
                    {it.kind}
                  </span>
                  {it.title || it.url || (it.content || "").slice(0, 60)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(it.id)}
                className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[0.7rem] text-muted transition hover:text-rust"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
    </div>
  );
}
