"use client";

import { useEffect, useState } from "react";

export type MeetingLeadState = {
  primaryAttendee: { email: string; name: string; matchedBy?: string } | null;
  leadChoices: { email: string; name: string }[];
  needsLeadConfirmation?: boolean;
  meetingEmail?: { subject: string } | null;
  leadSelectionVersion?: string | null;
  intentVersion?: string | null;
};

export default function MeetingLeadPicker({ lead, disabled, onConfirm }: {
  lead: MeetingLeadState;
  disabled: boolean;
  onConfirm: (email: string) => Promise<void>;
}) {
  const [choice, setChoice] = useState(lead.primaryAttendee?.email || "");
  useEffect(() => setChoice(lead.primaryAttendee?.email || ""), [lead.primaryAttendee?.email]);
  return (
    <section aria-label="Meeting lead" className={`mb-4 rounded-xl border px-4 py-3 ${lead.needsLeadConfirmation ? "border-amber/60 bg-amber/[0.06]" : "border-edge bg-panel/40"}`}>
      <h2 className="text-sm font-semibold text-bone">{lead.needsLeadConfirmation ? "Who is leading this conversation?" : `Preparing for ${lead.primaryAttendee?.name || "your meeting"}`}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {lead.meetingEmail ? `Using the selected email “${lead.meetingEmail.subject}”.` : "Your chosen lead's matching email context comes first. Other invitees are supporting participants."}
        {lead.primaryAttendee?.matchedBy === "manual_selection" ? " Your choice is saved for this meeting." : ""}
      </p>
      {lead.leadChoices.length ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-xs text-muted">
            Meeting lead
            <select aria-label="Meeting lead" value={choice} disabled={disabled} onChange={event => setChoice(event.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-bone disabled:opacity-50">
              <option value="">Choose the person this call is about</option>
              {lead.leadChoices.map(person => <option key={person.email} value={person.email}>{person.name} · {person.email}</option>)}
            </select>
          </label>
          <button type="button" disabled={disabled || !choice || (choice === lead.primaryAttendee?.email && lead.primaryAttendee?.matchedBy === "manual_selection")} onClick={() => void onConfirm(choice)} className="rounded-lg border border-amber/50 bg-amber/10 px-3 py-2 text-sm text-amber disabled:opacity-40">
            {disabled ? "Checking prep…" : "Use this lead"}
          </button>
        </div>
      ) : <p className="mt-2 text-sm text-amber">No eligible person is on this invite. Update the invitation or enter your own intent. You can still start the call.</p>}
    </section>
  );
}
