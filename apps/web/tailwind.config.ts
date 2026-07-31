import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#141311",
        card: "#1d1a17",
        muted: "#bda98f",
        accent: "#ff8a07",
        accentSoft: "#ffb15c"
      },
      boxShadow: {
        glow: "0 20px 45px rgba(0,0,0,.25)"
      }
    }
  },
  plugins: []
} satisfies Config;
