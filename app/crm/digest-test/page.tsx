"use client";

import { useState } from "react";

export default function DigestTestPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function sendTest() {
    if (status === "sending" || status === "sent") return;

    setStatus("sending");
    setMessage("");

    try {
      const response = await fetch("/api/crm/digest-test", { method: "POST" });
      const result = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "The test email could not be sent.");
      }

      setStatus("sent");
      setMessage("Test brief sent to your connected email address.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "The test email could not be sent.");
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl items-center px-4 py-10">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
          LiveCoach email preview
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Send a test brief</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This sends one live test to your own connected email address using only the CRM and calendar information available to your login.
        </p>

        <button
          type="button"
          onClick={sendTest}
          disabled={status === "sending" || status === "sent"}
          className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {status === "sending" ? "Sending…" : status === "sent" ? "Email sent" : "Send test email"}
        </button>

        {message ? (
          <p
            role="status"
            className={`mt-4 text-sm font-medium ${status === "error" ? "text-red-700" : "text-emerald-700"}`}
          >
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
