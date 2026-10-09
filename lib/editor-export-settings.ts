/**
 * Video Editor export settings — the allowlist shared by the export dialog,
 * the render route (validation + idempotency hash) and the FFmpeg graph.
 */
import type { EditorAspect } from "@/lib/editor-document";

export const EXPORT_RESOLUTIONS = [480, 720, 1080, 2160] as const;
export const EXPORT_QUALITIES = ["low", "standard", "high"] as const;
export const EXPORT_FPS = [30, 60] as const;
export const EXPORT_FORMATS = ["mp4", "webm"] as const;

export type ExportResolution = (typeof EXPORT_RESOLUTIONS)[number];
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];
export type ExportFps = (typeof EXPORT_FPS)[number];
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type EditorExportSettings = {
  /** Short side of the output, in pixels (aspect ratio is preserved). */
  resolution: ExportResolution;
  quality: ExportQuality;
  fps: ExportFps;
  format: ExportFormat;
};

export const DEFAULT_EXPORT_SETTINGS: EditorExportSettings = {
  resolution: 720,
  quality: "standard",
  fps: 30,
  format: "mp4",
};

export const EXPORT_QUALITY_LABEL: Record<ExportQuality, string> = {
  low: "Low quality",
  standard: "Standard quality",
  high: "High quality",
};

export const EXPORT_RESOLUTION_LABEL: Record<ExportResolution, string> = {
  480: "480p",
  720: "720p",
  1080: "1080p",
  2160: "4K (2160p)",
};

const CRF: Record<ExportQuality, number> = { low: 28, standard: 23, high: 20 };
/** VP9 constant-quality CRF (its scale runs higher than x264 for similar quality). */
const VP9_CRF: Record<ExportQuality, number> = { low: 38, standard: 33, high: 28 };

export function exportCrf(quality: ExportQuality): number {
  return CRF[quality];
}

/**
 * The single source for everything derived from a format: file extension, MIME, label,
 * and codec args. Always read from here with a validated `ExportFormat`, never client strings.
 */
export const EXPORT_FORMAT_SPEC: Record<
  ExportFormat,
  { ext: string; mime: string; label: string; videoCodec: string; audioCodec: string; audioBitrate: string; containerArgs: string[] }
> = {
  mp4: { ext: "mp4", mime: "video/mp4", label: "MP4", videoCodec: "libx264", audioCodec: "aac", audioBitrate: "192k", containerArgs: ["-movflags", "+faststart"] },
  webm: { ext: "webm", mime: "video/webm", label: "WebM", videoCodec: "libvpx-vp9", audioCodec: "libopus", audioBitrate: "128k", containerArgs: [] },
};

/** Local/output filename for an export, shared by the graph and the sandbox runner. */
export function exportOutputFilename(format: ExportFormat): string {
  return `editor_export.${EXPORT_FORMAT_SPEC[format].ext}`;
}

/**
 * Supabase Storage per-file limit for exports: the bucket is "Unset", so the 50 MB global limit applies (45 MB
 * uploads, 60 MB gets 413). Server override: `EDITOR_EXPORT_MAX_FILE_BYTES` (see `editorExportMaxFileBytes`).
 */
export const EDITOR_EXPORT_MAX_FILE_BYTES = 50_000_000;
/** Share of the limit the encode aims for (~42 MB); the rest absorbs container overhead and rate-control slack. */
const EXPORT_SIZE_TARGET_SHARE = 0.84;
/** VBV buffer in seconds of the cap rate (bufsize = 2 x maxrate). A full buffer can add this much on top of rate x length. */
const VBV_BUFFER_SEC = 2;
/**
 * CRF output on real footage stays under this many bits per pixel per frame at the graph's 30 fps content rate
 * (60 fps only duplicates frames, which cost almost nothing). A cap above that never binds, so it is left out and
 * exports that already fit keep their exact args.
 * ponytail: heuristic ceiling; a noisier source that still overshoots gets EDITOR_EXPORT_FILE_TOO_LARGE, not a lost file.
 */
const CRF_WORST_BITS_PER_PIXEL = 0.2;
const CONTENT_FPS = 30;

/**
 * Video bitrate ceiling (kbit/s) that keeps the whole file under `maxFileBytes`, or null when the export cannot
 * reach the limit anyway. Bound: video bits <= rate x (length + VBV buffer), plus audio at its fixed bitrate.
 */
export function exportVideoBitrateCapKbps(p: {
  format: ExportFormat;
  width: number;
  height: number;
  durationSec: number;
  hasAudio: boolean;
  maxFileBytes?: number;
}): number | null {
  const sec = Math.max(p.durationSec, 0.1);
  const audioBits = p.hasAudio ? Number.parseInt(EXPORT_FORMAT_SPEC[p.format].audioBitrate, 10) * 1000 * sec : 0;
  const videoBits = (p.maxFileBytes ?? EDITOR_EXPORT_MAX_FILE_BYTES) * 8 * EXPORT_SIZE_TARGET_SHARE - audioBits;
  const capBps = videoBits / (sec + VBV_BUFFER_SEC);
  if (capBps >= p.width * p.height * CONTENT_FPS * CRF_WORST_BITS_PER_PIXEL) return null;
  return Math.max(100, Math.floor(capBps / 1000));
}

/** Encoder args for the video stream; `capKbps` (see `exportVideoBitrateCapKbps`) bounds the file size. */
export function exportVideoArgs(settings: Pick<EditorExportSettings, "format" | "quality">, capKbps: number | null = null): string[] {
  if (settings.format === "webm") {
    // VP9 constrained quality: CRF with -b:v as the target average bitrate (0 = unconstrained); a file that still
    // overshoots fails as EDITOR_EXPORT_FILE_TOO_LARGE.
    return [
      "-c:v", EXPORT_FORMAT_SPEC.webm.videoCodec, "-b:v", capKbps ? `${capKbps}k` : "0", "-crf", String(VP9_CRF[settings.quality]),
      "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-threads", "8", "-pix_fmt", "yuv420p",
    ];
  }
  const vbv = capKbps ? ["-maxrate", `${capKbps}k`, "-bufsize", `${capKbps * VBV_BUFFER_SEC}k`] : [];
  return ["-c:v", EXPORT_FORMAT_SPEC.mp4.videoCodec, "-crf", String(exportCrf(settings.quality)), ...vbv, "-pix_fmt", "yuv420p"];
}

/** Audio codec args (only when the export has audio; otherwise `-an`). */
export function exportAudioArgs(format: ExportFormat): string[] {
  const spec = EXPORT_FORMAT_SPEC[format];
  return ["-c:a", spec.audioCodec, "-b:a", spec.audioBitrate];
}

/** Container args placed before the output file. */
export function exportContainerArgs(format: ExportFormat): string[] {
  return EXPORT_FORMAT_SPEC[format].containerArgs;
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
  const format = r.format ?? DEFAULT_EXPORT_SETTINGS.format;
  if (!(EXPORT_RESOLUTIONS as readonly unknown[]).includes(resolution)) return null;
  if (!(EXPORT_QUALITIES as readonly unknown[]).includes(quality)) return null;
  if (!(EXPORT_FPS as readonly unknown[]).includes(fps)) return null;
  if (!(EXPORT_FORMATS as readonly unknown[]).includes(format)) return null;
  return {
    resolution: resolution as ExportResolution,
    quality: quality as ExportQuality,
    fps: fps as ExportFps,
    format: format as ExportFormat,
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
