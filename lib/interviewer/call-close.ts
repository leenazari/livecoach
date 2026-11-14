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

export type LeadRecapFit = { title: string; why: string; slideNumber: number | null; slideTitle: string };
export type LeadRecapAnswer = { question: string; answer: string };

export type LeadRecap = {
  summary: string;
  businessType: string;
  howTheyServe: string;
  fits: LeadRecapFit[];
  answers: LeadRecapAnswer[];
  booked: boolean;
  when: string | null;
  nextStep: string;
};

export function leadRecap(brief: CallBrief): LeadRecap {
  const businessType = brief.profile?.businessType && !/not established/i.test(brief.profile.businessType)
    ? brief.profile.businessType
    : "";
  const howTheyServe = brief.service?.howTheyServe && !/not established/i.test(brief.service.howTheyServe)
    ? brief.service.howTheyServe
    : "";
  const slides = brief.slides || [];
  const improvements = (brief.service?.improvements || []).slice(0, 3);
  const fits: LeadRecapFit[] = (improvements.length ? improvements : slides.slice(0, 3).map((slide) => ({
    fit: slide.title || `Slide ${slide.number}`,
    suggestion: "This came up in the conversation.",
  }))).slice(0, 3).map((item) => {
    const slide = slides.find((entry) => {
      const title = (entry.title || "").toLowerCase();
      const fit = item.fit.toLowerCase();
      return title.includes(fit.slice(0, 12)) || fit.includes(title.slice(0, 12));
    }) || null;
    return {
      title: item.fit,
      why: item.suggestion,
      slideNumber: slide?.number ?? null,
      slideTitle: slide?.title || "",
    };
  });
  const answers = (brief.questions || [])
    .filter((item) => item.askedBy !== "agent" && item.answer && item.status !== "unanswered")
    .slice(0, 3)
    .map((item) => ({ question: item.question, answer: item.answer || "" }));
  const when = brief.appointment.when || null;
  return {
    summary: businessType
      ? `You run ${businessType.replace(/\.$/, "")}.`
      : "Thanks for talking with us.",
    businessType,
    howTheyServe,
    fits,
    answers,
    booked: brief.appointment.booked,
    when,
    nextStep: brief.appointment.booked
      ? "You're booked with one of our human team."
      : "You can pick a time with one of our human team.",
  };
}
