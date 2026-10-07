/**
 * Video Editor export settings — the allowlist shared by the export dialog,
 * the render route (validation + idempotency hash) and the FFmpeg graph.
 */
import type { EditorAspect } from "@/lib/editor-document";

export const EXPORT_RESOLUTIONS = [480, 720, 1080] as const;
export const EXPORT_QUALITIES = ["low", "standard", "high"] as const;
export const EXPORT_FPS = [30, 60] as const;

export type ExportResolution = (typeof EXPORT_RESOLUTIONS)[number];
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];
export type ExportFps = (typeof EXPORT_FPS)[number];

export type EditorExportSettings = {
  /** Short side of the output, in pixels (aspect ratio is preserved). */
  resolution: ExportResolution;
  quality: ExportQuality;
  fps: ExportFps;
};

export const DEFAULT_EXPORT_SETTINGS: EditorExportSettings = {
  resolution: 720,
  quality: "standard",
  fps: 30,
};

export const EXPORT_QUALITY_LABEL: Record<ExportQuality, string> = {
  low: "Low quality",
  standard: "Standard quality",
  high: "High quality",
};

const CRF: Record<ExportQuality, number> = { low: 28, standard: 23, high: 20 };

export function exportCrf(quality: ExportQuality): number {
  return CRF[quality];
}

/**
 * Validates untrusted input. `undefined` → defaults (older clients);
 * anything present but outside the allowlist → `null` (reject).
 */
export function parseExportSettings(raw: unknown): EditorExportSettings | null {
  if (raw === undefined || raw === null) return { ...DEFAULT_EXPORT_SETTINGS };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const resolution = r.resolution ?? DEFAULT_EXPORT_SETTINGS.resolution;
  const quality = r.quality ?? DEFAULT_EXPORT_SETTINGS.quality;
  const fps = r.fps ?? DEFAULT_EXPORT_SETTINGS.fps;
  if (!(EXPORT_RESOLUTIONS as readonly unknown[]).includes(resolution)) return null;
  if (!(EXPORT_QUALITIES as readonly unknown[]).includes(quality)) return null;
  if (!(EXPORT_FPS as readonly unknown[]).includes(fps)) return null;
  return {
    resolution: resolution as ExportResolution,
    quality: quality as ExportQuality,
    fps: fps as ExportFps,
  };
}

const evenPx = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output size for an aspect at the chosen short-side resolution (even dimensions). */
export function exportDimensions(aspect: EditorAspect, resolution: ExportResolution): { w: number; h: number } {
  const long = evenPx((resolution * 16) / 9);
  if (aspect === "1:1") return { w: resolution, h: resolution };
  return aspect === "9:16" ? { w: resolution, h: long } : { w: long, h: resolution };
}

/** Strips control characters, trims, caps at 80; falls back when empty. */
export function sanitizeExportTitle(raw: unknown, fallback = "Editor export"): string {
  if (typeof raw !== "string") return fallback;
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned || fallback;
}
