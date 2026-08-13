import type { Config } from "tailwindcss";
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["Fraunces", "serif"],
        sans: ["'IBM Plex Sans'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      colors: {
        // Theme-aware RGB channels. Keeping the existing semantic names means
        // every CRM, Brain and call component switches as one design system.
        ink: "rgb(var(--lc-ink) / <alpha-value>)",
        panel: "rgb(var(--lc-panel) / <alpha-value>)",
        panel2: "rgb(var(--lc-panel2) / <alpha-value>)",
        edge: "rgb(var(--lc-edge) / <alpha-value>)",
        bone: "rgb(var(--lc-bone) / <alpha-value>)",
        muted: "rgb(var(--lc-muted) / <alpha-value>)",
        amber: "rgb(var(--lc-amber) / <alpha-value>)",
        amberglow: "rgb(var(--lc-amberglow) / <alpha-value>)",
        sage: "rgb(var(--lc-sage) / <alpha-value>)",
        moss: "rgb(var(--lc-moss) / <alpha-value>)",
        rust: "rgb(var(--lc-rust) / <alpha-value>)",
        sky: "rgb(var(--lc-sky) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
export default config;
