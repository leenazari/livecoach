// Keyword detection and prompt assembly for approved company answers.
// The draft stays a draft: this module never sends, schedules or queues mail.
// EMAIL_REPLY_POLICY_GUIDANCE defaults on. Set it to 0, false, off or no and
// redeploy to roll back. A failed lesson lookup also leaves the draft unchanged.

export const EMAIL_REPLY_POLICY_GUIDANCE_ENV = "EMAIL_REPLY_POLICY_GUIDANCE";

export type PolicyLessonSource = {
  id?: string | null;
  title?: string | null;
  topic?: string | null;
  content?: string | null;
  status?: string | null;
  visibility?: string | null;
  created_at?: string | null;
};

export type PolicyTopicMatch = {
  id: string;
  labels: string[];
};

type PolicyDetector = {
  label: string;
  pattern: RegExp;
};

type PolicyTopic = {
  id: string;
  detectors: PolicyDetector[];
  // Any one of these in a lesson title or tags selects that lesson.
  lessonTerms: string[];
};

const CERT = String.raw`SOC\s*-?\s*2|ISO\s*-?\s*27001`;
const CERT_PAIR = String.raw`(?:${CERT})(?:\s+and\s+(?:${CERT}))?`;

// One topic family so a question about SOC 2 still finds the approved lesson
// whose title says GDPR, retention, deletion or security. Future answers are
// another entry here plus a workspace-visible approved lesson, not a row id.
const EMAIL_REPLY_POLICY_TOPICS: PolicyTopic[] = [
  {
    id: "data-protection",
    detectors: [
      { label: "gdpr", pattern: /\bgdpr\b/i },
      { label: "data protection", pattern: /\bdata protection\b/i },
      { label: "data storage", pattern: /\bdata storage\b|\bdata stored\b|\bstored data\b/i },
      { label: "hosting", pattern: /\bdata hosting\b|\bhosting\b|\bhosted\b/i },
      { label: "data residency", pattern: /\bdata residency\b/i },
      { label: "retention", pattern: /\bretention\b/i },
      { label: "deletion", pattern: /\bdeletion\b|\bdelet(?:e|ed|ing|ion)\b[^.\n]{0,40}\bdata\b|\bdata\b[^.\n]{0,20}\bdelet(?:e|ed|ion)\b/i },
      { label: "security", pattern: /\bsecurity\b/i },
      { label: "audit logs", pattern: /\baudit logs?\b/i },
      { label: "soc 2", pattern: /\bsoc\s*-?\s*2\b/i },
      { label: "iso 27001", pattern: /\biso\s*-?\s*27001\b/i },
    ],
    lessonTerms: [
      "gdpr",
      "data protection",
      "data storage",
      "data hosting",
      "hosting",
      "data residency",
      "retention",
      "deletion",
      "security",
      "audit log",
      "soc 2",
      "soc2",
      "iso 27001",
      "iso27001",
    ],
  },
];

const DISABLED = /^(0|false|off|no)$/i;

export function emailReplyPolicyGuidanceEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env[EMAIL_REPLY_POLICY_GUIDANCE_ENV];
  if (raw == null || raw.trim() === "") return true;
  return !DISABLED.test(raw.trim());
}

export function detectEmailReplyPolicyTopics(text: string): PolicyTopicMatch[] {
  const source = String(text || "");
  if (!source.trim()) return [];
  return EMAIL_REPLY_POLICY_TOPICS.flatMap((topic) => {
    const labels = topic.detectors
      .filter((detector) => detector.pattern.test(source))
      .map((detector) => detector.label);
    return labels.length ? [{ id: topic.id, labels }] : [];
  });
}

function parsedLesson(content: string | null | undefined): Record<string, unknown> | null {
  const raw = String(content || "").trim();
  if (!raw.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function tagText(parsed: Record<string, unknown> | null): string {
  if (!parsed) return "";
  const tags = parsed.tags;
  if (Array.isArray(tags)) return tags.map((tag) => String(tag || "")).join(" ");
  return typeof tags === "string" ? tags : "";
}

export function policyLessonHaystack(lesson: PolicyLessonSource): string {
  const parsed = parsedLesson(lesson.content);
  const nestedTitle = typeof parsed?.title === "string" ? parsed.title : "";
  return [lesson.title || "", nestedTitle, tagText(parsed)].join("\n").toLowerCase();
}

function includesTerm(haystack: string, term: string): boolean {
  const needle = term.toLowerCase().trim();
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  if (!/[\s-]/.test(needle)) return false;
  return haystack.replace(/[\s-]+/g, "").includes(needle.replace(/[\s-]+/g, ""));
}

function topicById(id: string): PolicyTopic | undefined {
  return EMAIL_REPLY_POLICY_TOPICS.find((topic) => topic.id === id);
}

export function scorePolicyLesson(
  lesson: PolicyLessonSource,
  topics: PolicyTopicMatch[]
): number {
  const haystack = policyLessonHaystack(lesson);
  let score = 0;
  for (const match of topics) {
    const topic = topicById(match.id);
    if (!topic) continue;
    const termHits = topic.lessonTerms.filter((term) => includesTerm(haystack, term)).length;
    if (!termHits) continue;
    const labelHits = match.labels.filter((label) => includesTerm(haystack, label)).length;
    score += labelHits * 100 + termHits;
  }
  return score;
}

export function selectPolicyLessons<T extends PolicyLessonSource>(
  lessons: T[],
  topics: PolicyTopicMatch[]
): T[] {
  const chosen: T[] = [];
  for (const topic of topics) {
    const best = lessons
      .map((lesson) => ({ lesson, score: scorePolicyLesson(lesson, [topic]) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return String(right.lesson.created_at || "").localeCompare(
          String(left.lesson.created_at || "")
        );
      })[0];
    if (best && !chosen.includes(best.lesson)) chosen.push(best.lesson);
  }
  return chosen.slice(0, 3);
}

const clip = (value: unknown, maximum: number) =>
  String(value || "")
    .replace(/\s+\n/g, "\n")
    .trim()
    .slice(0, maximum);

function lines(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clip(item, 500)).filter(Boolean).slice(0, maximum);
}

function renderLesson(lesson: PolicyLessonSource): string {
  const parsed = parsedLesson(lesson.content);
  const title = clip(lesson.title || parsed?.title || "Approved lesson", 240);
  if (!parsed) {
    const plain = clip(lesson.content, 4_000);
    return plain ? `LESSON: ${title}\n${plain}` : "";
  }
  const objections = Array.isArray(parsed.objections)
    ? parsed.objections
        .slice(0, 8)
        .map((item) => {
          if (!item || typeof item !== "object") return "";
          const record = item as Record<string, unknown>;
          const signal = clip(record.signal, 240);
          const response = clip(record.response, 600);
          return signal && response ? `- ${signal} -> ${response}` : "";
        })
        .filter(Boolean)
    : [];
  const parts = [
    `LESSON: ${title}`,
    parsed.principle ? `Principle: ${clip(parsed.principle, 600)}` : "",
    parsed.scenario ? `Use when: ${clip(parsed.scenario, 600)}` : "",
    parsed.standardResponse ? `Approved wording:\n${clip(parsed.standardResponse, 4_000)}` : "",
    lines(parsed.script, 12).length ? `Approved lines:\n${lines(parsed.script, 12).join("\n")}` : "",
    objections.length ? `Approved answers:\n${objections.join("\n")}` : "",
    lines(parsed.avoid, 8).length ? `Do not:\n${lines(parsed.avoid, 8).map((item) => `- ${item}`).join("\n")}` : "",
    parsed.liveCoachSafeguard ? `Safeguard: ${clip(parsed.liveCoachSafeguard, 800)}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

export function formatPolicyGuidance(
  lessons: PolicyLessonSource[],
  topics: PolicyTopicMatch[]
): string {
  const rendered = lessons.map(renderLesson).filter(Boolean).join("\n\n").slice(0, 8_000);
  if (!rendered.trim()) return "";
  const asked = [...new Set(topics.flatMap((topic) => topic.labels))].join(", ");
  return [
    "APPROVED COMPANY GUIDANCE",
    `The inbound email asks about: ${asked}.`,
    "Use the approved lesson below as the basis for that part of the draft only. Keep the wording faithful to the lesson. Do not add audits, numbers or certifications the lesson does not state.",
    "Say \"working towards\" SOC 2 and ISO 27001. Never claim SOC 2 or ISO 27001 certification. Describe Cyber Essentials only as the lesson describes it.",
    "Do not complete a full security questionnaire in this draft. Escalate full security questionnaires to Lee when the lesson notes say to. If a lesson note conflicts with an offer to complete a questionnaire, follow the note.",
    "Answer the rest of the email in the salesperson's voice. This is still a draft for the salesperson to review and send. Do not send it.",
    rendered,
  ].join("\n");
}

export function appendEmailReplyPolicyGuidance(prompt: string, guidance: string): string {
  const block = String(guidance || "").trim();
  if (!block) return prompt;
  return `${prompt}\n\n${block}`;
}

export function policySystemAddendum(guidance: string): string {
  if (!String(guidance || "").trim()) return "";
  return "\n\nApproved company guidance in the user message is a supplied fact for the part of the email it covers. Keep that wording faithful. Say \"working towards\" SOC 2 and ISO 27001, and never claim those certifications. Escalate a full security questionnaire to Lee and do not complete one in this draft. Do not invent claims beyond the guidance. The usual word limit may be exceeded for those approved lines. Keep any required booking link and opt-out. This remains a draft and must not be sent.";
}

function canonicalCert(value: string): string {
  const compact = value.toLowerCase().replace(/[\s-]+/g, "");
  const parts: string[] = [];
  if (compact.includes("soc2")) parts.push("SOC 2");
  if (compact.includes("iso27001")) parts.push("ISO 27001");
  return parts.join(" and ") || value.trim();
}

// Safety net for the model. The approved lesson already says "working towards".
// Cyber Essentials certification is left untouched.
export function preserveWorkingTowardsCertifications(text: string): string {
  const source = String(text || "");
  const notCertified = new RegExp(
    String.raw`(?:n't|\bnot)\s+(?:yet\s+|currently\s+)?(${CERT_PAIR})\s+certified\b`,
    "gi"
  );
  const certifiedTo = new RegExp(String.raw`\bcertified\s+to\s+(${CERT_PAIR})\b`, "gi");
  const namedCertified = new RegExp(String.raw`\b(${CERT_PAIR})\s+certified\b`, "gi");
  const namedCertification = new RegExp(
    String.raw`\b(${CERT_PAIR})\s+certificat(?:e|es|ion)\b`,
    "gi"
  );
  const replaceCert = (_match: string, certs: string) => `working towards ${canonicalCert(certs)}`;
  return source
    .replace(notCertified, (match, certs: string) => {
      const lead = /^n't/i.test(match) ? " " : "";
      return `${lead}working towards ${canonicalCert(certs)}`;
    })
    .replace(certifiedTo, replaceCert)
    .replace(namedCertified, replaceCert)
    .replace(namedCertification, (_match, certs: string, offset: number, whole: string) => {
      const before = whole.slice(Math.max(0, offset - 24), offset);
      if (/working towards\s+$/i.test(before)) return _match;
      return `${canonicalCert(certs)} (working towards)`;
    });
}

// The approved standard response offers to complete a questionnaire. The lesson
// notes override that offer: a full questionnaire goes to Lee.
export function preserveQuestionnaireEscalation(text: string): string {
  return String(text || "").replace(
    /we(?:['’]re| are) happy to complete your security questionnaire or set up a call with our technical team/gi,
    "Lee can take the security questionnaire from here, or we can set up a call with our technical team"
  );
}

export function applyPolicyGuidanceToDraft<T>(text: T, guidance: string): T | string {
  if (!String(guidance || "").trim()) return text;
  return preserveQuestionnaireEscalation(preserveWorkingTowardsCertifications(String(text ?? "")));
}

export async function resolveEmailReplyPolicyGuidance(input: {
  emailText: string;
  enabled: boolean;
  loadLessons: () => Promise<PolicyLessonSource[]>;
}): Promise<string> {
  if (!input.enabled) return "";
  const topics = detectEmailReplyPolicyTopics(input.emailText);
  if (!topics.length) return "";
  let lessons: PolicyLessonSource[];
  try {
    lessons = await input.loadLessons();
  } catch {
    return "";
  }
  const selected = selectPolicyLessons(Array.isArray(lessons) ? lessons : [], topics);
  if (!selected.length) return "";
  return formatPolicyGuidance(selected, topics);
}
