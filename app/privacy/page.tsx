import type { Metadata } from "next";
import Link from "next/link";
import LiveCoachLogo from "@/components/LiveCoachLogo";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "How LiveCoach CRM collects, uses, protects and deletes personal information.",
};

const updated = "30 August 2026";

function PolicySection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-edge pt-7">
      <h2 className="font-display text-2xl text-bone">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-muted">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main className="relative z-10 mx-auto min-h-screen max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
      <ThemeToggle className="absolute right-5 top-5 sm:right-8" />

      <header className="pr-16">
        <Link href="/login" aria-label="LiveCoach CRM sign in">
          <LiveCoachLogo
            markClassName="h-12 w-12"
            wordmarkClassName="font-display text-[2.4rem] leading-none tracking-tight"
          />
        </Link>
        <p className="mt-3 font-mono text-xs uppercase tracking-[0.24em] text-amber">
          Privacy policy
        </p>
        <h1 className="mt-5 max-w-3xl font-display text-4xl leading-tight text-bone sm:text-5xl">
          Your information should work for you, without becoming visible to the wrong person.
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-muted">
          This policy explains what LiveCoach CRM handles, why it is needed, who it may be shared with,
          and how you can access, disconnect or delete it.
        </p>
        <p className="mt-4 font-mono text-[0.64rem] uppercase tracking-[0.18em] text-muted">
          Last updated {updated}
        </p>
      </header>

      <article className="mt-10 space-y-8 rounded-2xl border border-edge bg-panel/50 p-6 sm:p-9">
        <PolicySection title="Who is responsible">
          <p>
            LiveCoach CRM is operated by Lee Nazari in the United Kingdom. LiveCoach CRM is the data
            controller for account and product data it decides how to use. An employer or organisation
            using LiveCoach CRM may be the controller for information its users add about clients,
            prospects, staff and call participants.
          </p>
          <p>
            Privacy questions and requests can be sent to{" "}
            <a className="text-amber hover:text-amberglow" href="mailto:lee@ai13.com">
              lee@ai13.com
            </a>
            .
          </p>
        </PolicySection>

        <PolicySection title="Information we handle">
          <ul className="list-disc space-y-2 pl-5 marker:text-amber">
            <li>Account details such as name, email address, role and workspace membership.</li>
            <li>CRM records such as contacts, companies, opportunities, tasks, notes and activity history.</li>
            <li>Calendar events and email content or metadata when a user connects Google or Microsoft.</li>
            <li>Meeting details, live transcription, call transcripts, summaries and coaching output.</li>
            <li>Outreach drafts, approvals, sent messages, replies, suppressions and campaign activity.</li>
            <li>Private team-chat messages and files shared with selected workspace members.</li>
            <li>Connected-service identifiers, permissions and security tokens needed to maintain a connection.</li>
            <li>Inbound LinkedIn message content and sender profile links when a user runs the optional local inbox capture.</li>
            <li>Technical logs used for authentication, security, reliability, usage control and troubleshooting.</li>
          </ul>
          <p>
            Audio may be streamed to an authorised transcription provider during a live call. LiveCoach CRM
            stores the transcript and related notes when that feature is used. It does not intentionally use
            hidden advertising trackers or sell personal information.
          </p>
        </PolicySection>

        <PolicySection title="Google, Microsoft and LinkedIn connections">
          <p>
            Connected services are optional. LiveCoach CRM requests only the permissions needed for the
            feature a user chooses, such as reading a calendar, reading or sending authorised email, or
            identifying the connected account.
          </p>
          <p>
            Google Drive storage is optional and user initiated. When a user presses Save to Drive on a chat
            attachment, LiveCoach CRM copies that selected file into a LiveCoach folder in that user&apos;s
            connected Drive. The limited Drive permission does not allow LiveCoach CRM to browse or manage
            unrelated Drive files. Nothing is copied automatically and the saved file is not automatically
            shared with other chat members.
          </p>
          <p>
            If LinkedIn access is enabled, LiveCoach CRM will use LinkedIn information only within the
            permissions LinkedIn has approved and for functions the connected user has requested. It will not
            sell LinkedIn data or publish an action without the user-facing control required for that feature.
          </p>
          <p>
            LinkedIn&apos;s approved API connection does not provide inbox access. LiveCoach CRM also offers an
            optional local Chrome connector that a user must start manually from their signed-in LinkedIn
            Messaging tab. It reads recent visible inbound messages and sends only the selected message fields
            to that user&apos;s private CRM. The connector does not send LinkedIn passwords, session cookies or
            outgoing actions to LiveCoach CRM. It cannot send messages, connection requests, likes or posts.
            Opening conversations during capture may mark them as read.
          </p>
          <p>
            A user can disconnect a provider in LiveCoach CRM settings and can also revoke access in the
            provider account. Revocation stops new collection. Data already saved in legitimate CRM records is
            handled under the retention and deletion terms below.
          </p>
        </PolicySection>

        <PolicySection title="How we use information">
          <ul className="list-disc space-y-2 pl-5 marker:text-amber">
            <li>Authenticate users and keep workspaces separated.</li>
            <li>Synchronise authorised calendars and mailboxes.</li>
            <li>Copy a selected chat attachment to the requesting user&apos;s connected Drive.</li>
            <li>Prepare, support and summarise calls.</li>
            <li>Maintain CRM history, priorities, pipelines and approved outreach.</li>
            <li>Generate requested drafts, coaching and next-step suggestions.</li>
            <li>Prevent duplicate outreach, honour opt-outs and enforce sending limits.</li>
            <li>Protect the service, investigate failures and meet legal obligations.</li>
          </ul>
          <p>
            The legal basis depends on the context. It may be performance of a contract, legitimate interests
            in operating a secure business CRM, consent for an optional connection or recording feature, or a
            legal obligation. Users must notify call participants and obtain any consent required by applicable
            law and workplace policy.
          </p>
        </PolicySection>

        <PolicySection title="Who processes information">
          <p>
            LiveCoach CRM uses carefully selected service providers for hosting, authentication, database
            storage, email and calendar connections, meeting bots, transcription and artificial intelligence.
            This currently includes infrastructure or services supplied by Vercel, Supabase, Google, Microsoft,
            LinkedIn, Recall.ai, Deepgram, LiveKit and OpenAI where the relevant feature is used.
          </p>
          <p>
            Providers receive only the information needed to perform their service. Information may also be
            disclosed when legally required, to protect users or the service, or during a properly controlled
            business transfer. LiveCoach CRM does not sell personal information.
          </p>
          <p>
            Some providers process information outside the United Kingdom. Where required, appropriate legal
            safeguards are used for international transfers.
          </p>
        </PolicySection>

        <PolicySection title="Retention and deletion">
          <p>
            Information is kept only for as long as needed for the active account, the CRM record, security,
            dispute handling and legal obligations. Different records have different useful lives. A completed
            client history may need to be retained longer than a temporary connection log.
          </p>
          <p>
            Users can request deletion of their account, connected-service data or LinkedIn data by emailing the
            privacy contact above. The request should identify the account and the information concerned.
            LiveCoach CRM will verify the requester, remove or anonymise eligible information, and explain any
            information that must be retained. Backups may retain protected copies for a limited recovery period
            before they are overwritten.
          </p>
          <p>
            A file copied to Google Drive is a separate copy controlled by the connected Google account.
            Disconnecting Google or deleting the CRM attachment does not delete that Drive copy. The user must
            remove it from Drive when it is no longer needed.
          </p>
        </PolicySection>

        <PolicySection title="Your choices and rights">
          <p>
            Depending on the law that applies, a person may ask for access, correction, deletion, restriction,
            portability or an objection to processing. Consent can be withdrawn where consent is the basis.
            A person can also complain to the UK Information Commissioner&apos;s Office.
          </p>
          <p>
            Requests should be sent to the privacy contact above. LiveCoach CRM may need enough information to
            verify identity and locate the relevant records before acting.
          </p>
        </PolicySection>

        <PolicySection title="Security and access separation">
          <p>
            LiveCoach CRM uses authentication, workspace membership, role checks, record ownership, access
            controls and audit history to reduce unauthorised access. Private founder records and connected
            mailbox data are not intended to become visible merely because another salesperson joins a shared
            workspace. No online service can promise absolute security, so suspected misuse should be reported
            promptly.
          </p>
        </PolicySection>

        <PolicySection title="Changes to this policy">
          <p>
            This policy may change when LiveCoach CRM adds a provider, permission or material use of data. The
            date above will be updated and significant changes will be brought to users&apos; attention where
            appropriate.
          </p>
        </PolicySection>
      </article>

      <footer className="flex flex-col gap-3 py-8 font-mono text-[0.64rem] uppercase tracking-[0.16em] text-muted sm:flex-row sm:items-center sm:justify-between">
        <span>LiveCoach CRM</span>
        <Link className="text-amber hover:text-amberglow" href="/login">
          Return to sign in
        </Link>
      </footer>
    </main>
  );
}
