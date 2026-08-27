/**
 * Design tokens for the homepage landing, originally derived from arqe.ai's
 * live stylesheet as a self-contained monochrome system. Now retired onto the
 * app-wide DS v2 tokens (tailwind.config.mjs's N-scale + brand-primary) instead
 * of hardcoded hex, so this surface matches the rest of the app (dashboard,
 * tools, auth) — see kelolako-design-system-v2-rollout. Kept as named exports
 * (rather than inlining the classes in every component) purely so the
 * monochrome "voice" — weights, tracking, which N-step plays which role —
 * stays centralized and easy to tune in one place.
 */

export const HELLO_COLORS = {
  stage: "#000000", // N0
  panel: "#121212", // N50
  panelRaised: "#121212", // N50
  border: "#333333", // N100 (white/10 in practice — see `hairline` below)
  borderStrong: "#4D4D4D", // N200 (white/20 in practice — see `hairline` hover)
  textPrimary: "#CCCCCC", // N700
  textEmphasis: "#E6E6E6", // N800
  textSecondary: "#B3B3B3", // N600
  textMuted: "#808080", // N400
  invertBg: "#FFFFFF", // N900
  invertBgHover: "#E6E6E6", // N800
  invertFg: "#000000", // N0
} as const;

/* Surfaces. Panels are separated from the stage by fill alone — no outline. */
export const stage = "bg-N0";
export const panel = "rounded-xl bg-N50";
export const panelFlat = "bg-N50";
// Glassmorphism white-overlay borders, matching the pattern already
// established on the dashboard shell/auth forms — not a solid N-step.
export const hairline = "border-white/10";

/* Text */
export const textPrimary = "text-N700";
export const textEmphasis = "text-N800";
export const textSecondary = "text-text-secondary";
export const textMuted = "text-text-disabled";

/** Small uppercase label above a section heading. */
export const eyebrow = "text-[11px] font-medium uppercase tracking-[0.18em] text-text-disabled";

/** Section heading — Space Grotesk, matching every other heading in the app. */
export const heading = "font-display font-medium leading-[1.06] tracking-[-0.02em] text-N900";
export const headingSize = "clamp(1.75rem, 5vw, 3rem)";

/** Monospaced-feeling section index (01, 02, ...) — an arqe signature. */
export const indexNumeral = "text-[11px] font-medium tabular-nums tracking-[0.08em] text-text-disabled";

/* Calls to action — radius-xl (16px) matches Button.tsx's actual DS v2 shape,
   not a pill; only genuinely circular elements (icon badges, avatars) stay
   rounded-full. */
export const ctaGhost =
  "inline-flex items-center gap-2 rounded-radius-xl border border-white/10 px-5 py-2.5 text-sm font-medium text-N700 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-N900";
/** Primary CTA — brand orange against the near-black stage. */
export const ctaAccent =
  "inline-flex items-center gap-2 rounded-radius-xl bg-brand-primary py-2 pl-5 pr-2 text-sm font-medium text-text-on-solid transition-colors hover:bg-brand-primary-hover";

/** Glass surface: arqe blurs 15-20px behind translucent panels. */
export const glass = "bg-white/[0.04] backdrop-blur-[15px]";
