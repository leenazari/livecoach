import { redirect } from "next/navigation";

// The real interviewer console lives at /call (session-scoped, with opening
// questions, competency picker, live cues, summary). The old InterviewConsole
// is retired - send everyone straight to /call (middleware handles login).
export default function Home() {
  redirect("/call");
}
