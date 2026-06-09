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
        ink: "#0f1217",
        panel: "#171b22",
        panel2: "#1c212a",
        edge: "#2a2f3a",
        bone: "#e9e5db",
        muted: "#8a909d",
        amber: "#e0a458",
        amberglow: "#f5c97a",
        sage: "#8bb89a",
        rust: "#c97a5c",
        sky: "#7fa8d0",
      },
    },
  },
  plugins: [],
};
export default config;
