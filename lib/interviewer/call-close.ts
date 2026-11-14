import type { CallBrief } from "./brief";

export function leadDeclinedDemo(lines: string[]): boolean {
  return lines.some((line) => /\b(no demo|no meeting|not interested|no thanks|no thank you|rather not|don'?t want (a )?(demo|meeting)|do not want (a )?(demo|meeting)|don'?t book|do not book)\b/i.test(line));
}

export function wrapUpAnswer(text: string): "yes" | "no" | null {
  const value = text.trim();
  if (!value) return null;
  if (/\b(no thanks|no thank you|not now|no demo|don'?t|do not)\b/i.test(value) || /^(no|nope|nah)\b/i.test(value)) return "no";
  if (/\b(yes|yeah|yep|sure|okay|ok|please|book|demo|useful)\b/i.test(value)) return "yes";
  return null;
}

export const PLACEHOLDER_OUTCOME = "Call ended before an outcome was recorded";

export function dispositionFromIntent(label: "HOT" | "WARM" | "NURTURE" | "NOT INTERESTED", reasons: string[]): { disposition: "Hot" | "Warm" | "Nurture" | "Closed lost"; reason: string } {
  const disposition = label === "HOT" ? "Hot" : label === "WARM" ? "Warm" : label === "NOT INTERESTED" ? "Closed lost" : "Nurture";
  const reason = label === "NOT INTERESTED"
    ? "Not interested"
    : reasons.map((item) => item.trim()).find((item) => item && !/not established/i.test(item)) || "Taken from what was said on the call.";
  return { disposition, reason: reason.slice(0, 160) };
}

export function intentFromTranscript(transcript: string, booked: boolean): "HOT" | "WARM" | "NURTURE" {
  if (booked || /\b(booked|let'?s book|book a demo|sign me up)\b/i.test(transcript)) return "HOT";
  if (/\b(interested|tell me more|how much|what does it cost|send me|follow up)\b/i.test(transcript)) return "WARM";
  return "NURTURE";
}

export function featureBullets(text: string): string[] {
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const part of text.split(/\n+/)) {
    const line = part.replace(/^[-*•\d.)\s]+/, "").replace(/\s+/g, " ").trim();
    if (line.length < 3 || line.length > 140) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.push(line.endsWith(".") ? line : `${line}.`);
    if (bullets.length >= 5) break;
  }
  return bullets;
}

export function leadRecap(brief: CallBrief): { summary: string; topics: string[]; nextStep: string } {
  const topics = [
    ...brief.timeline.map((item) => item.label).filter((label) => !/call started|call ended/i.test(label)),
    /not established/i.test(brief.lead.interest) ? "" : brief.lead.interest,
  ].map((item) => item.trim()).filter(Boolean).slice(0, 5);
  const when = brief.appointment.when ? ` for ${new Date(brief.appointment.when).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "";
  const nextStep = brief.appointment.booked
    ? `A demo is booked${when}. ${brief.appointment.agenda}`.trim()
    : (brief.nextSteps[0] || "No further step was agreed.");
  return {
    summary: brief.howItWent.summary,
    topics,
    nextStep,
  };
}
