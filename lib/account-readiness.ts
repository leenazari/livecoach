export type AccountReadinessRole = "owner" | "manager" | "sales";
export type AccountReadinessState = "ready" | "action";

export type AccountReadinessCheck = {
  id:
    | "account"
    | "sales_profile"
    | "email"
    | "calendar"
    | "transcriber"
    | "leads"
    | "privacy"
    | "test_email"
    | "test_call";
  label: string;
  state: AccountReadinessState;
  detail: string;
  href?: string;
  actionLabel?: string;
};

export type AccountReadiness = {
  userId: string;
  displayName: string;
  email: string;
  role: AccountReadinessRole;
  readyCount: number;
  totalCount: number;
  isReady: boolean;
  checks: AccountReadinessCheck[];
};

export type AccountReadinessFacts = {
  userId: string;
  displayName: string | null;
  email: string | null;
  role: AccountReadinessRole;
  membershipStatus: string;
  salesProfileComplete: boolean;
  connectedProviderCount: number;
  provider: "google" | "microsoft" | null;
  providerEmail: string | null;
  mailRead: boolean;
  mailSend: boolean;
  senderName: string | null;
  senderEmail: string | null;
  senderVerified: boolean;
  calendarConnected: boolean;
  lastCalendarSyncAt: string | null;
  transcriberName: string;
  transcriberPlatformReady: boolean;
  assignedProspects: number;
  sharedPoolProspects: number;
  sharedClients: number;
  privacyBoundaryActive: boolean;
  privacyTestConfirmedAt: string | null;
  testEmailCompletedAt: string | null;
  transcribedCalls: number;
};

const readableDateTime = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
    hourCycle: "h23",
  }).format(date);
};

const action = (
  id: AccountReadinessCheck["id"],
  label: string,
  detail: string,
  href: string | undefined,
  actionLabel: string
): AccountReadinessCheck => ({
  id,
  label,
  state: "action",
  detail,
  href,
  actionLabel,
});

const ready = (
  id: AccountReadinessCheck["id"],
  label: string,
  detail: string
): AccountReadinessCheck => ({ id, label, state: "ready", detail });

export function buildAccountReadiness(
  facts: AccountReadinessFacts,
  now = new Date()
): AccountReadiness {
  const checks: AccountReadinessCheck[] = [];
  const identityReady =
    facts.membershipStatus === "active" &&
    !!facts.displayName?.trim() &&
    !!facts.email?.trim();
  checks.push(
    identityReady
      ? ready(
          "account",
          "Account active",
          `${facts.displayName} is signed in with an active ${facts.role} account.`
        )
      : action(
          "account",
          "Finish account setup",
          "This login still needs an active membership, name and account email.",
          facts.role === "owner" ? "/settings/team" : undefined,
          facts.role === "owner" ? "Open team access" : "Ask Lee to activate it"
        )
  );

  checks.push(
    facts.salesProfileComplete
      ? ready(
          "sales_profile",
          "Personal sales setup",
          "Your products, customers, working style and coaching preferences are saved to your login."
        )
      : action(
          "sales_profile",
          "Complete personal sales setup",
          "Add your role, target customers, products and coaching style so LiveCoach adapts to you.",
          "/settings/sales-profile",
          "Complete setup"
        )
  );

  const providerName =
    facts.provider === "google"
      ? "Google"
      : facts.provider === "microsoft"
        ? "Microsoft"
        : "Email";
  if (facts.connectedProviderCount > 1) {
    checks.push(
      action(
        "email",
        "Choose one email connection",
        "Both Google and Microsoft are connected. Disconnect the mailbox you do not use so nothing can send twice.",
        "/settings",
        "Review connections"
      )
    );
  } else if (!facts.provider) {
    checks.push(
      action(
        "email",
        "Connect email",
        "Connect this person's own Google or Microsoft mailbox before using email context or outreach.",
        "/settings",
        "Connect email"
      )
    );
  } else if (!facts.mailRead || !facts.mailSend) {
    checks.push(
      action(
        "email",
        `${providerName} permissions need attention`,
        `${providerName} is connected${facts.providerEmail ? ` as ${facts.providerEmail}` : ""}, but email reading or sending has not been verified for this login.`,
        "/settings",
        "Check permissions"
      )
    );
  } else if (
    !facts.senderName?.trim() ||
    !facts.senderEmail?.trim() ||
    !facts.senderVerified
  ) {
    checks.push(
      action(
        "email",
        "Confirm sending identity",
        "The mailbox works, but the name and address used for outreach still need to be confirmed by this person.",
        "/settings/sales-profile",
        "Confirm sender"
      )
    );
  } else {
    checks.push(
      ready(
        "email",
        "Email ready",
        `${providerName} can read and send as ${facts.senderName} <${facts.senderEmail}>.`
      )
    );
  }

  const lastCalendarSync = facts.lastCalendarSyncAt
    ? new Date(facts.lastCalendarSyncAt)
    : null;
  const syncAge = lastCalendarSync
    ? now.getTime() - lastCalendarSync.getTime()
    : Number.POSITIVE_INFINITY;
  const syncFresh =
    !!lastCalendarSync &&
    Number.isFinite(lastCalendarSync.getTime()) &&
    syncAge >= 0 &&
    syncAge <= 26 * 60 * 60 * 1000;
  if (!facts.calendarConnected) {
    checks.push(
      action(
        "calendar",
        "Connect calendar",
        "Connect this person's calendar so their meetings become their own upcoming calls.",
        "/settings",
        "Connect calendar"
      )
    );
  } else if (!syncFresh) {
    checks.push(
      action(
        "calendar",
        "Refresh calendar",
        facts.lastCalendarSyncAt
          ? `The last successful sync was ${readableDateTime(facts.lastCalendarSyncAt)}.`
          : "The calendar is connected, but no successful sync is recorded yet.",
        "/settings",
        "Open calendar settings"
      )
    );
  } else {
    checks.push(
      ready(
        "calendar",
        "Calendar current",
        `Last successful sync was ${readableDateTime(facts.lastCalendarSyncAt)}.`
      )
    );
  }

  checks.push(
    facts.transcriberPlatformReady && !!facts.transcriberName
      ? ready(
          "transcriber",
          "Personal call notetaker",
          `${facts.transcriberName} is generated for this login. Each user receives a separate call bot without another Railway deployment.`
        )
      : action(
          "transcriber",
          "Call notetaker needs administrator setup",
          "The shared call service is missing part of its secure production configuration.",
          facts.role === "owner" ? "/settings/team" : undefined,
          facts.role === "owner" ? "Open team access" : "Ask Lee to check it"
        )
  );

  const leadCount =
    facts.assignedProspects + facts.sharedPoolProspects + facts.sharedClients;
  checks.push(
    leadCount > 0
      ? ready(
          "leads",
          "Leads available",
          `${facts.assignedProspects} assigned, ${facts.sharedPoolProspects} available in the shared pool and ${facts.sharedClients} shared client records.`
        )
      : action(
          "leads",
          "Add or assign leads",
          "This person has no assigned prospects, shared pool prospects or shared client records yet.",
          "/crm/outreach?tab=prospects",
          "Open prospects"
        )
  );

  if (facts.role === "owner") {
    checks.push(
      ready(
        "privacy",
        "Owner access",
        "You retain full owner access. Team members receive only their own private records and explicitly shared sales records."
      )
    );
  } else if (facts.privacyBoundaryActive && facts.privacyTestConfirmedAt) {
    checks.push(
      ready(
        "privacy",
        "Privacy boundary confirmed",
        `Lee confirmed the isolation rehearsal on ${readableDateTime(facts.privacyTestConfirmedAt)}.`
      )
    );
  } else {
    checks.push(
      action(
        "privacy",
        "Privacy rehearsal needs Lee",
        "Access is isolated by user, but Lee must finish and sign off the two account privacy rehearsal before live work.",
        undefined,
        "Ask Lee to sign it off"
      )
    );
  }

  checks.push(
    facts.testEmailCompletedAt
      ? ready(
          "test_email",
          "Test email completed",
          `A rehearsal or successful outreach send was recorded on ${readableDateTime(facts.testEmailCompletedAt)}.`
        )
      : action(
          "test_email",
          "Send one rehearsal email",
          "Prepare a draft and send it only to your own mailbox before contacting a prospect.",
          "/crm/outreach?tab=prospects",
          "Open outreach"
        )
  );

  checks.push(
    facts.transcribedCalls > 0
      ? ready(
          "test_call",
          "Test call completed",
          `${facts.transcribedCalls} call${facts.transcribedCalls === 1 ? "" : "s"} with stored transcription evidence belong to this login.`
        )
      : action(
          "test_call",
          "Complete one test call",
          "Start a short test call, admit your personal notetaker and confirm that a transcript is saved to your account.",
          "/call",
          "Start test call"
        )
  );

  const readyCount = checks.filter((check) => check.state === "ready").length;
  return {
    userId: facts.userId,
    displayName: facts.displayName || facts.email || "LiveCoach user",
    email: facts.email || "",
    role: facts.role,
    readyCount,
    totalCount: checks.length,
    isReady: readyCount === checks.length,
    checks,
  };
}
