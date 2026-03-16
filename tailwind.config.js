/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // ── Romio design tokens ──────────────────────────────────────────
      // Derived directly from the mascot's color palette
      colors: {
        // Core brand
        romio: {
          black:    "#1C1C1E",   // body / primary dark surface
          cream:    "#F5F0E8",   // face / primary light surface
          red:      "#E03030",   // antenna dot / high-tops / errors
          green:    "#4A8C5C",   // floppy disk / success / valid
          gray:     "#8A8A8A",   // side panel / neutral
          "gray-dark": "#2C2C2E", // secondary surface
        },
        // Semantic aliases
        background: {
          DEFAULT:  "#0F0F11",   // app background — near-black warm
          surface:  "#1C1C1E",   // card / panel surface
          elevated: "#252528",   // elevated surface (modals, popovers)
        },
        border: {
          DEFAULT:  "#2E2E32",
          muted:    "#1E1E22",
        },
        // Validation state colors
        state: {
          valid:      "#4A8C5C",   // PRESENT_VALID — romio green
          warning:    "#C47C1A",   // PRESENT_WRONG_PATH
          error:      "#E03030",   // MISSING_REQUIRED / PRESENT_HASH_MISMATCH
          advisory:   "#6B7280",   // MISSING_OPTIONAL
          info:       "#3B82F6",   // informational
        },
      },
      fontFamily: {
        sans:  ["Nunito", "DM Sans", "system-ui", "sans-serif"],
        mono:  ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
      fontSize: {
        // Slightly larger defaults for readability in a utility app
        "xs":   ["0.75rem",  { lineHeight: "1rem" }],
        "sm":   ["0.875rem", { lineHeight: "1.25rem" }],
        "base": ["1rem",     { lineHeight: "1.6rem" }],
        "lg":   ["1.125rem", { lineHeight: "1.75rem" }],
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        "sm":    "0.375rem",
        "md":    "0.5rem",
        "lg":    "0.75rem",
        "xl":    "1rem",
      },
      // Subtle scanline texture applied to backgrounds
      backgroundImage: {
        "scanlines": "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)",
      },
      animation: {
        "romio-pulse": "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in":     "fadeIn 0.2s ease-out",
        "slide-up":    "slideUp 0.25s ease-out",
        "slide-in":    "slideIn 0.2s ease-out",
      },
      keyframes: {
        fadeIn:  { "0%": { opacity: "0" },                          "100%": { opacity: "1" } },
        slideUp: { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        slideIn: { "0%": { opacity: "0", transform: "translateX(-8px)" }, "100%": { opacity: "1", transform: "translateX(0)" } },
      },
      // Romio's thick-outline illustration style reflected in box shadows
      boxShadow: {
        "romio":    "0 0 0 2px #1C1C1E, 0 4px 16px rgba(0,0,0,0.4)",
        "romio-sm": "0 0 0 1.5px #1C1C1E, 0 2px 8px rgba(0,0,0,0.3)",
      },
    },
  },
  plugins: [],
};
