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
        ink: "#0e0d0b",
        panel: "#16140f",
        edge: "#2a261d",
        bone: "#ece6d8",
        muted: "#8c8472",
        amber: "#e0a34a",
        amberglow: "#f5c97a",
        sage: "#7e9b78",
        rust: "#c06a4a",
      },
    },
  },
  plugins: [],
};

export default config;
