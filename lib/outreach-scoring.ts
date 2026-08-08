export type OutreachRecommendationAction = "contact_today" | "hold" | "skip";

export type OutreachRecommendation = {
  action: OutreachRecommendationAction;
  label: "Contact today" | "Hold" | "Skip";
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  risks: string[];
};

type ScoringOptions = {
  campaign?: any;
  learnings?: any[];
  blockedTargets?: Set<string>;
  activeClientDomains?: Set<string>;
  dueFollowUp?: boolean;
};

const STOP_WORDS = new Set([
  "and", "the", "for", "with", "from", "that", "this", "their", "your",
  "business", "businesses", "leaders", "senior", "people", "help", "into",
  "book", "focused", "demonstration", "founders", "company", "companies",
]);

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "icloud.com",
  "yahoo.com", "aol.com", "live.com", "me.com",
]);

const clean = (value: any) => String(value || "").trim().toLowerCase();
const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, Math.round(value)));

function tokens(value: any): Set<string> {
  return new Set(
    clean(value)
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
  );
}

function overlap(left: any, right: any): number {
  const a = tokens(left);
  const b = tokens(right);
  let count = 0;
  for (const word of a) if (b.has(word)) count += 1;
  return count;
}

function roleAuthority(jobTitle: string): { points: number; reason: string } {
  const title = clean(jobTitle);
  if (!title) return { points: 0, reason: "" };
  if (/\b(founder|co-founder|owner|chief|ceo|cxo|managing director|partner)\b/.test(title)) {
    return { points: 18, reason: "Senior decision-maker role" };
  }
  if (/\b(director|head|vice president|vp)\b/.test(title)) {
    return { points: 15, reason: "Likely budget or functional authority" };
  }
  if (/\b(manager|lead|principal|talent|recruit|learning|training|people|admission|employability)\b/.test(title)) {
    return { points: 10, reason: "Role is close to an Interviewa use case" };
  }
  return { points: 4, reason: "Named business contact" };
}

export function scoreOutreachProspect(
  prospect: any,
  options: ScoringOptions = {}
): OutreachRecommendation {
  const reasons: { text: string; points: number }[] = [];
  const risks: string[] = [];
  const email = clean(prospect?.email);
  const emailDomain = email.includes("@") ? email.split("@").pop() || "" : "";
  const companyDomain = clean(prospect?.company_domain).replace(/^www\./, "");
  const status = clean(prospect?.status || "imported");
  const blocked = options.blockedTargets || new Set<string>();
  const activeDomains = options.activeClientDomains || new Set<string>();

  const hardSkip = (reason: string): OutreachRecommendation => ({
    action: "skip",
    label: "Skip",
    score: 0,
    confidence: "high",
    reasons: [reason],
    risks,
  });

  if (!email || !email.includes("@")) return hardSkip("No usable email address");
  if (blocked.has(email) || (companyDomain && blocked.has(companyDomain))) {
    return hardSkip("On the do-not-contact list");
  }
  if (prospect?.crm_company_id || (companyDomain && activeDomains.has(companyDomain))) {
    return hardSkip("Already an active CRM relationship");
  }
  if (["suppressed", "not_interested"].includes(status)) {
    return hardSkip("Previously opted out or marked not interested");
  }
  if (["replied", "qualified"].includes(status)) {
    return hardSkip("Already replied, continue through the CRM instead");
  }

  let score = clamp(Number(prospect?.priority_score) || 0) * 0.3;
  if (score >= 21) reasons.push({ text: "Strong imported fit signals", points: score });
  else if (score >= 12) reasons.push({ text: "Some imported fit signals", points: score });

  const manualPriority = clean(prospect?.priority);
  const priorityPoints = manualPriority === "high" ? 12 : manualPriority === "medium" ? 7 : 2;
  score += priorityPoints;
  if (manualPriority === "high") reasons.push({ text: "Manually marked high priority", points: priorityPoints });

  const authority = roleAuthority(prospect?.job_title || "");
  score += authority.points;
  if (authority.reason) reasons.push({ text: authority.reason, points: authority.points });
  else risks.push("Role is missing, so buying authority is unclear");

  const campaignText = `${options.campaign?.audience || ""} ${options.campaign?.offer_angle || ""}`;
  const prospectText = `${prospect?.job_title || ""} ${prospect?.industry || ""} ${prospect?.company_name || ""} ${prospect?.public_profile || ""}`;
  const audienceOverlap = overlap(campaignText, prospectText);
  const audiencePoints = audienceOverlap >= 2 ? 15 : audienceOverlap === 1 ? 10 : 0;
  score += audiencePoints;
  if (audiencePoints) reasons.push({ text: "Matches this campaign’s audience", points: audiencePoints });
  else if (campaignText.trim()) risks.push("No clear campaign-audience match in the saved data");

  if (/\buk\b|united kingdom|britain/i.test(campaignText) && /\buk\b|united kingdom|england|scotland|wales|northern ireland/i.test(`${prospect?.country || ""} ${prospect?.state || ""}`)) {
    score += 3;
    reasons.push({ text: "Matches the campaign geography", points: 3 });
  }

  let dataPoints = 0;
  if (prospect?.company_domain || prospect?.website) dataPoints += 3;
  if (prospect?.person_linkedin_url) dataPoints += 3;
  if (prospect?.company_linkedin_url) dataPoints += 2;
  if (prospect?.industry) dataPoints += 2;
  if (prospect?.employee_range) dataPoints += 2;
  score += dataPoints;
  if (dataPoints >= 8) reasons.push({ text: "Good data for credible personalisation", points: dataPoints });
  if (!prospect?.company_domain && !prospect?.website) risks.push("No company website or domain saved");
  if (PERSONAL_EMAIL_DOMAINS.has(emailDomain)) {
    score -= 8;
    risks.push("Personal email makes company identity less certain");
  }

  const research = prospect?.research && typeof prospect.research === "object" ? prospect.research : null;
  if (research) {
    const confidence = clean(research.confidence);
    const researchPoints = confidence === "high" ? 8 : confidence === "medium" ? 5 : -2;
    score += researchPoints;
    if (researchPoints > 0) reasons.push({ text: `${confidence} confidence research is already saved`, points: researchPoints });
    else risks.push("Existing research confidence is low");
    if (research.bestAngle && Array.isArray(research.signals) && research.signals.length) {
      score += 4;
      reasons.push({ text: "A grounded commercial angle is already available", points: 4 });
    }
  }

  const learningTarget = `${prospect?.job_title || ""} ${research?.bestAngle || ""}`;
  const matchedLearning = (options.learnings || []).find((learning: any) =>
    learning?.status === "promoted" &&
    Number(learning?.sent_count) >= 10 &&
    ["persona", "angle"].includes(learning?.dimension) &&
    overlap(learning?.label, learningTarget) > 0
  );
  if (matchedLearning) {
    const learningPoints = Number(matchedLearning.meeting_count) > 0 ? 6 : 4;
    score += learningPoints;
    reasons.push({
      text: Number(matchedLearning.meeting_count) > 0
        ? "Similar outreach has already produced a meeting"
        : "Similar outreach has produced positive replies",
      points: learningPoints,
    });
  }

  if (options.dueFollowUp) {
    score = Math.max(score, 72);
    reasons.push({ text: "An approved sequence follow-up is due", points: 20 });
  }

  score = clamp(score);
  reasons.sort((a, b) => b.points - a.points);
  const evidenceCount = [prospect?.job_title, prospect?.industry, prospect?.company_domain || prospect?.website, prospect?.person_linkedin_url].filter(Boolean).length;
  const confidence: "high" | "medium" | "low" = research?.confidence === "high" && evidenceCount >= 3
    ? "high"
    : evidenceCount >= 2
      ? "medium"
      : "low";
  const action: OutreachRecommendationAction = options.dueFollowUp
    ? "contact_today"
    : status === "contacted"
      ? "hold"
      : score >= 62
        ? "contact_today"
        : score >= 38
          ? "hold"
          : "skip";

  if (status === "contacted" && !options.dueFollowUp) risks.unshift("Already contacted; wait until the next sequence step is due");
  else if (action === "hold") risks.unshift("Worth keeping, but stronger fit evidence is needed before using a daily send slot");
  if (action === "skip") risks.unshift("Current fit is too weak for a limited outreach slot");

  return {
    action,
    label: action === "contact_today" ? "Contact today" : action === "hold" ? "Hold" : "Skip",
    score,
    confidence,
    reasons: reasons.slice(0, 4).map((reason) => reason.text),
    risks: risks.slice(0, 3),
  };
}
