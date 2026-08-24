import { redirect } from "next/navigation";

// The CRM chooses the correct role-aware home. Middleware sends sales and
// manager accounts to their isolated Sales Desk while owners retain the wider
// executive dashboard.
export default function Home() {
  redirect("/crm");
}
