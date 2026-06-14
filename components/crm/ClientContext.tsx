"use client";

import { useEffect, useRef, useState } from "react";
import { crmFetch } from "@/lib/crm";
import { extractDocText } from "@/lib/extract-doc";

type Item = {
  id: string;
  kind: "note" | "link" | "doc";
  title: string | null;
  url: string | null;
  content: string | null;
  created_at: string;
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

  const load = () =>
    crmFetch<{ items: Item[] }>(`/api/crm/companies/${companyId}/context`)
      .then((d) => setItems(d.items || []))
      .catch(() => {});

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

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
  );
}
