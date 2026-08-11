/**
 * Design tokens for the /hello landing variant, derived from arqe.ai's live
 * stylesheet. A strictly monochrome, zero-chroma system: near-black stage,
 * slightly lifted panels, hairline borders, a grey text ramp, and a single
 * inverted white pill as the only "accent".
 *
 * Kept as local constants rather than a Tailwind theme extension so the variant
 * stays self-contained and cannot leak into the default landing design.
 */

export const HELLO_COLORS = {
  stage: "#0a0a0a",
  panel: "#171717",
  panelRaised: "#1d1d1d",
  border: "#2a2a2a",
  borderStrong: "#3a3a3a",
  textPrimary: "#cccccc",
  textEmphasis: "#dddddd",
  textSecondary: "#aaaaaa",
  textMuted: "#8a8a8a",
  invertBg: "#fafafa",
  invertBgHover: "#e0e0e0",
  invertFg: "#111111",
} as const;

/* Surfaces. Panels are separated from the stage by fill alone — no outline. */
export const stage = "bg-[#0a0a0a]";
export const panel = "rounded-xl bg-[#171717]";
export const panelFlat = "bg-[#171717]";
export const hairline = "border-[#2a2a2a]";

/* Text */
export const textPrimary = "text-[#cccccc]";
export const textEmphasis = "text-[#dddddd]";
export const textSecondary = "text-[#aaaaaa]";
export const textMuted = "text-[#8a8a8a]";

/** Small uppercase label above a section heading. */
export const eyebrow =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[#8a8a8a]";

/** Section heading. arqe sets everything at weight 400-500 with tight tracking. */
export const heading = "font-medium leading-[1.06] tracking-[-0.02em] text-white";
export const headingSize = "clamp(1.75rem, 5vw, 3rem)";

/** Monospaced-feeling section index (01, 02, ...) — an arqe signature. */
export const indexNumeral =
  "text-[11px] font-medium tabular-nums tracking-[0.08em] text-[#8a8a8a]";

/* Calls to action */
export const ctaGhost =
  "inline-flex items-center gap-2 rounded-full border border-[#2a2a2a] px-5 py-2.5 text-sm font-medium text-[#cccccc] transition-colors hover:border-[#3a3a3a] hover:bg-white/[0.04] hover:text-white";
/** Primary CTA pill — brand orange against the near-black stage. */
export const ctaAccent =
  "inline-flex items-center gap-2 rounded-full bg-[#f97316] py-2 pl-5 pr-2 text-sm font-medium text-white transition-colors hover:bg-[#ea580c]";

/** Glass surface: arqe blurs 15-20px behind translucent panels. */
export const glass = "bg-white/[0.04] backdrop-blur-[15px]";
