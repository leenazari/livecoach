// The demo call is a bearer link. It is not a LiveCoach account page.
export function isPublicInterviewerJoin(pathname: string): boolean {
  return /^\/i\/[^/]+$/.test(pathname) || /^\/c\/[^/]+$/.test(pathname);
}

// Call APIs take the invite token. They are not the private /api/interview coach.
export function isPublicInterviewerApi(pathname: string): boolean {
  return pathname === "/api/interviewer" || pathname.startsWith("/api/interviewer/");
}
