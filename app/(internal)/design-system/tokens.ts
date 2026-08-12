import tailwindConfig from "@/tailwind.config.mjs";

// Reads directly from the Tailwind theme config so this page can never
// visually drift from the real tokens — grouping/labels below are the only
// hand-authored bits; every value comes from tailwind.config.mjs itself.

type FontSizeEntry = [string, { lineHeight: string; letterSpacing: string }];

const extend = tailwindConfig.theme.extend;
const colors = extend.colors as Record<string, string>;
const fontSize = extend.fontSize as unknown as Record<string, FontSizeEntry>;
const spacing = extend.spacing as Record<string, string>;
const borderRadius = extend.borderRadius as Record<string, string>;
const boxShadow = extend.boxShadow as Record<string, string>;

const RAW_SCALE_STEPS = [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

const RAW_HUES = [
  { prefix: "N", label: "Neutral" },
  { prefix: "O", label: "Primary (Orange)" },
  { prefix: "B", label: "Info (Blue)" },
  { prefix: "G", label: "Success (Green)" },
  { prefix: "Y", label: "Warning (Yellow)" },
  { prefix: "R", label: "Error (Red)" },
] as const;

const ALPHA_KEYS = ["A80", "A60", "AW40", "AB40"] as const;
const NON_SEMANTIC_KEYS = new Set<string>(["background", "foreground", ...ALPHA_KEYS]);
const RAW_KEY_PATTERN = /^[NOBGYR]\d+$/;

export const rawColorScales = RAW_HUES.map(({ prefix, label }) => ({
  label,
  swatches: RAW_SCALE_STEPS.map((step) => ({
    name: `${prefix}${step}`,
    hex: colors[`${prefix}${step}`],
  })),
}));

export const alphaSwatches = ALPHA_KEYS.map((name) => ({
  name,
  value: colors[name],
}));

export const semanticSwatches = Object.keys(colors)
  .filter((key) => !RAW_KEY_PATTERN.test(key) && !NON_SEMANTIC_KEYS.has(key))
  .map((name) => ({ name, value: colors[name] }));

export const typographyScale = Object.entries(fontSize)
  .filter(([name]) => !name.startsWith("button-"))
  .map(([name, [size, opts]]) => ({
    name,
    size,
    lineHeight: opts.lineHeight,
  }));

export const spacingScale = Object.entries(spacing).map(([name, value]) => ({ name, value }));
export const radiusScale = Object.entries(borderRadius).map(([name, value]) => ({ name, value }));
export const shadowScale = Object.entries(boxShadow).map(([name, value]) => ({ name, value }));
