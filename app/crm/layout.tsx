import { Suspense, type ReactNode } from "react";
import GlobalAssistant from "@/components/crm/GlobalAssistant";
import DocumentJobTray from "@/components/crm/DocumentJobTray";
import SalesOutreachTutorial from "@/components/crm/SalesOutreachTutorial";

// One assistant for the whole CRM. Mounted here in the layout so it PERSISTS
// across page navigation - the window stays open and the conversation isn't
// lost when you move between pages. It reads the current page from the URL to
// know which client you're looking at, while keeping one continuous chat.
export default function CrmLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <GlobalAssistant />
      </Suspense>
      <Suspense fallback={null}>
        <SalesOutreachTutorial />
      </Suspense>
      <DocumentJobTray />
    </>
  );
}
