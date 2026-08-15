/** @type {import('tailwindcss').Config} */

// Kelolako design system — raw color scales, verified against Figma.
// Keys intentionally mirror the Figma token names (N/O/B/G/Y/R + step) so
// there is a 1:1 mental map back to the source doc, and so these can never
// collide with Tailwind's own built-in "neutral"/"orange"/"blue"/etc. palettes.
const N = {
  0: "#000000",
  50: "#121212",
  100: "#333333",
  200: "#4D4D4D",
  300: "#666666",
  400: "#808080",
  500: "#999999",
  600: "#B3B3B3",
  700: "#CCCCCC",
  800: "#E6E6E6",
  900: "#FFFFFF",
};

const O = {
  0: "#170802",
  50: "#2A1207",
  100: "#421A09",
  200: "#5C240A",
  300: "#81320C",
  400: "#B24610",
  500: "#F26522",
  600: "#FF7B33",
  700: "#FF995A",
  800: "#FFBC8D",
  900: "#FFE2C9",
};

const B = {
  0: "#05111F",
  50: "#081727",
  100: "#0E223A",
  200: "#153152",
  300: "#1D4672",
  400: "#2A66A5",
  500: "#3B82F6",
  600: "#63A2FF",
  700: "#90C2FF",
  800: "#BEDDFF",
  900: "#EAF4FF",
};

const G = {
  0: "#07110C",
  50: "#081A12",
  100: "#0D2819",
  200: "#123A23",
  300: "#185332",
  400: "#1E7745",
  500: "#22C55E",
  600: "#4CE17E",
  700: "#7AF0A2",
  800: "#B8F8CC",
  900: "#E8FFF0",
};

const Y = {
  0: "#120C02",
  50: "#211603",
  100: "#352304",
  200: "#4C3205",
  300: "#684708",
  400: "#9A6A09",
  500: "#F59E0B",
  600: "#FFB82D",
  700: "#FFD061",
  800: "#FFE4A0",
  900: "#FFF4D4",
};

const R = {
  0: "#170505",
  50: "#250808",
  100: "#3B0E0E",
  200: "#551515",
  300: "#771D1D",
  400: "#A92A2A",
  500: "#EF4444",
  600: "#FF6767",
  700: "#FF9393",
  800: "#FFC0C0",
  900: "#FFE8E8",
};

const ALPHA = {
  A80: "rgba(255, 255, 255, 0.8)",
  A60: "rgba(255, 255, 255, 0.6)",
  AW40: "rgba(255, 255, 255, 0.4)",
  AB40: "rgba(23, 27, 34, 0.4)",
};

function rawScale(letter, scale) {
  return Object.fromEntries(
    Object.entries(scale).map(([step, hex]) => [`${letter}${step}`, hex])
  );
}

// Semantic aliases — every value below references a raw scale entry above
// (same JS source, not a re-typed hex) except the handful of custom values
// explicitly called out as such in the Figma-verified token docs.
const semanticColors = {
  // Background — resolved app roles
  "bg-base": N[0],
  "bg-surface": N[100],
  // No confirmed Figma value for surface-2 yet — placeholder per doc's own
  // instruction not to invent one. See design.md decision #5.
  "bg-surface-2": N[100],
  "bg-disabled": N[200],

  // Background — full Figma "Background" semantic group
  "bg-base-surface": N[100],
  "bg-sunken-surface": N[50],
  "bg-background-surface": N[0],
  "bg-disabled-surface": N[200],
  "bg-high-orange": O[500],
  "bg-low-orange": O[100],
  "bg-high-blue": B[500],
  "bg-low-blue": B[100],
  "bg-high-green": G[500],
  "bg-low-green": G[100],
  "bg-high-red": R[500],
  "bg-low-red": R[100],
  "bg-high-yellow": Y[500],
  "bg-low-yellow": Y[100],
  "bg-static-white": N[900],
  "bg-static-black": N[0],

  // Typography
  "text-primary": N[800],
  "text-secondary": N[600],
  "text-on-solid": N[900],
  "text-high-emphasis": N[800],
  "text-low-emphasis": N[600],
  "text-disabled": N[400],
  "text-invert": N[0],
  "text-subtle-invert": ALPHA.A80,
  "text-light-invert": ALPHA.A60,
  "text-on-activity": O[500],
  "text-alert": R[500],
  "text-analytic": Y[500],
  "text-positive": G[500],
  "text-static-white": N[900],
  "text-static-black": N[0],

  // Icon
  "icon-high-emphasis": N[700],
  "icon-low-emphasis": N[500],
  "icon-disabled": N[300],
  "icon-invert": N[0],
  "icon-subtle-invert": ALPHA.A80,
  "icon-light-invert": ALPHA.A60,
  "icon-on-activity": O[500],
  "icon-alert": R[500],
  "icon-analytic": Y[500],
  "icon-positive": G[500],
  "icon-static-white": N[900],
  "icon-static-black": N[0],

  // Stroke
  "border-default": N[600],
  "stroke-bold": N[900],
  "stroke-strong": N[700],
  "stroke-regular": N[600],
  "stroke-disabled": N[400],
  "stroke-invert": N[200],
  "stroke-on-activity": O[500],
  "stroke-alert": R[500],
  "stroke-analytic": Y[500],
  "stroke-positive": G[500],

  // Status
  success: G[500],
  warning: Y[500],
  error: R[500],
  info: B[500],

  // Brand + primary button gradient (locked values; hover/pressed gradient
  // stops are a derivation from the raw scale — see design.md decision #4)
  "brand-primary": O[500],
  "brand-primary-light": O[600],
  "brand-primary-hover": "#E05A1A",
  "brand-primary-pressed": "#C94D16",
  "brand-primary-gradient-hover-start": O[500],
  "brand-primary-gradient-hover-end": O[400],
  "brand-primary-gradient-pressed": O[400],

  // Danger button hover/pressed (kelolako-button-component.html reference)
  "danger-hover": "#DC2626",
  "danger-pressed": "#B91C1C",

  // Secondary/tertiary button overlay states — rgba over brand-primary
  // (kelolako-button-component.html reference)
  "secondary-enabled": "rgba(242, 101, 34, 0.14)",
  "secondary-hover": "rgba(242, 101, 34, 0.20)",
  "secondary-pressed": "rgba(242, 101, 34, 0.28)",
  "tertiary-hover": "rgba(242, 101, 34, 0.08)",
  "tertiary-pressed": "rgba(242, 101, 34, 0.14)",
  "spinner-track-brand": "rgba(242, 101, 34, 0.25)",

  // On-media button overlay states
  "overlay-scrim": "rgba(0, 0, 0, 0.45)",
  "overlay-scrim-hover": "rgba(0, 0, 0, 0.6)",
  "onmedia-pressed": "rgba(0, 0, 0, 0.72)",
  "onmedia-border": "rgba(255, 255, 255, 0.12)",
};

const config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#030712",
        foreground: "#ffffff",
        ...rawScale("N", N),
        ...rawScale("O", O),
        ...rawScale("B", B),
        ...rawScale("G", G),
        ...rawScale("Y", Y),
        ...rawScale("R", R),
        ...ALPHA,
        ...semanticColors,
      },
      fontFamily: {
        // Reuses the existing --font-display variable already loaded in
        // app/layout.tsx (Space Grotesk) — not loaded again here.
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        h1: ["56px", { lineHeight: "62px", letterSpacing: "0" }],
        h2: ["38px", { lineHeight: "44px", letterSpacing: "0" }],
        h3: ["28px", { lineHeight: "34px", letterSpacing: "0" }],
        "body-1": ["18px", { lineHeight: "24px", letterSpacing: "0" }],
        "body-2": ["16px", { lineHeight: "22px", letterSpacing: "0" }],
        "body-3": ["14px", { lineHeight: "20px", letterSpacing: "0" }],
        small: ["12px", { lineHeight: "16px", letterSpacing: "0" }],
        "extra-small": ["10px", { lineHeight: "14px", letterSpacing: "0" }],
        "button-lg": ["15px", { lineHeight: "1", letterSpacing: "0" }],
        "button-md": ["14px", { lineHeight: "1", letterSpacing: "0" }],
        "button-sm": ["13px", { lineHeight: "1", letterSpacing: "0" }],
      },
      spacing: {
        "spacing-sm": "8px",
        "spacing-md": "12px",
        "spacing-lg": "16px",
        "spacing-xl": "24px",
        "spacing-xxl": "32px",
        "spacing-3xl": "48px",
        "spacing-4xl": "64px",
        "spacing-5xl": "96px",
        "spacing-6xl": "128px",
      },
      borderRadius: {
        "radius-none": "0px",
        "radius-xs": "2px",
        "radius-sm": "4px",
        "radius-md": "8px",
        "radius-lg": "12px",
        "radius-xl": "16px",
        "radius-2xl": "20px",
        "radius-3xl": "24px",
        "radius-4xl": "32px",
      },
      boxShadow: {
        "elevation-00": "none",
        "elevation-01": "0px 2px 8px 0px rgba(48, 49, 53, 0.16)",
        "elevation-02": "0px 4px 12px 0px rgba(48, 49, 53, 0.20)",
      },
      animation: {
        'fade-in': 'fade-in 1s ease-out',
        'marquee-left': 'marquee-left 60s linear infinite',
        'marquee-right': 'marquee-right 75s linear infinite',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'marquee-left': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        'marquee-right': {
          from: { transform: 'translateX(-50%)' },
          to: { transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
