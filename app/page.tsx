import { redirect } from "next/navigation";

// Outreach is the working home for LiveCoach. The call console remains one tap
// away in the persistent navigation (middleware handles login).
export default function Home() {
  redirect("/crm/outreach");
}
