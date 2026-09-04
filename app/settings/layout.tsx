import { Suspense, type ReactNode } from "react";

import SalesOutreachTutorial from "@/components/crm/SalesOutreachTutorial";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <SalesOutreachTutorial />
      </Suspense>
    </>
  );
}
