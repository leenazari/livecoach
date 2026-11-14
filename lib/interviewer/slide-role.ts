export type SlideRole = "feature" | "setup" | "intro" | "contact";

export function slideRole(title: string): SlideRole {
  const text = String(title || "").toLowerCase();
  if (/\b(setup|set-up|set up|onboarding|install|installation|getting started|get started|how to get started)\b/.test(text)) return "setup";
  if (/\b(contact|book|get in touch|next step|let'?s talk|speak to|start your next)\b/.test(text)) return "contact";
  if (/^(meet|welcome|introduction|about)\b/.test(text) || /\bwho we are\b/.test(text)) return "intro";
  return "feature";
}

export function walkOrderNote(slides: Array<{ number: number; title: string }>): string {
  const tagged = slides.map((slide) => ({ ...slide, role: slideRole(slide.title) }));
  const nums = (role: SlideRole) => tagged.filter((slide) => slide.role === role).map((slide) => slide.number).join(", ") || "none";
  return `Walk order. Feature slides first: ${nums("feature")}. Prefer one that matches what they just said, then continue in that order. Intro, one sentence only: ${nums("intro")}. Contact after the features: ${nums("contact")}. Setup, onboarding and how to get started, skip unless they ask: ${nums("setup")}. Near the close, one line is enough: setup is quick, the team handles it.`;
}
