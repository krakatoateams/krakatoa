/**
 * Reels Creator engine/schema registry — the single source of truth shared by
 * the Reels Creator composer (UI) and the unified `/api/generate-reels` route.
 *
 * One subtool, two engines:
 *   - seedance: 1-3 scenes × 5/10s, 480p/720p, MiniMax narration
 *   - veo:      single | perScene modes, 4/6/8s, 720p/1080p (1080p ⇒ 8s)
 *
 * `validateReelsRequest` normalizes + validates the request body and resolves the
 * stable identifiers (jobType / jobTool / creationTool) the route bills and logs
 * under. Keeping these here means the UI and server can never drift.
 */
import { seedancePricingKey, veoPricingKey } from "@/lib/pricing-math";
import type {
  CaptionStyle,
  ReelsEngine,
  ReelsVeoMode,
} from "@/lib/reels-pipeline/types";

export const DEFAULT_VOICE_ID = "English_CaptivatingStoryteller";

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontname: "Arial",
  fontsize: 28,
  primaryColor: "#FFFFFF",
  highlightColor: "#FFFF00",
  outlineColor: "#000000",
  outlineThickness: 4,
  marginV: 15,
  highlightOnly: false,
};

/** MiniMax speech-02-turbo emotions the server accepts (after resolving "auto"). */
export const MINIMAX_EMOTIONS = [
  "happy",
  "sad",
  "angry",
  "fearful",
  "disgusted",
  "surprised",
  "calm",
  "fluent",
  "neutral",
] as const;
export type MinimaxEmotion = (typeof MINIMAX_EMOTIONS)[number];

// ---------------------------------------------------------------------------
// Option metadata for the composer UI.
// ---------------------------------------------------------------------------
export const SEEDANCE_SCENE_COUNTS = [1, 2, 3] as const;
export const SEEDANCE_DURATIONS = [5, 10] as const;
export const SEEDANCE_RESOLUTIONS = ["480p", "720p"] as const;

export const VEO_DURATIONS = [4, 6, 8] as const;
export const VEO_RESOLUTIONS = ["720p", "1080p"] as const;
export const VEO_SINGLE_PROMPT_SCENES = [1, 2] as const;
export const VEO_PERSCENE_COUNTS = [1, 2, 3] as const;

export type SeedanceResolution = (typeof SEEDANCE_RESOLUTIONS)[number];
export type VeoResolution = (typeof VEO_RESOLUTIONS)[number];

export const REELS_ENGINES: { id: ReelsEngine; label: string; blurb: string }[] = [
  {
    id: "seedance",
    label: "Seedance 2 Fast",
    blurb: "Multi-scene reels with MiniMax narration (bytedance/seedance-2.0-fast)",
  },
  {
    id: "veo",
    label: "Veo 3.1 Lite",
    blurb: "Google Veo with native or per-scene audio (google/veo-3.1-lite)",
  },
];

/**
 * Catalog model id each engine actually runs (reels.video / veo.video in model_configs).
 * Reels Creator UI gates engines on these ids — not every reels-creator-eligible tier.
 */
export const REELS_ENGINE_CATALOG_MODEL_ID: Record<ReelsEngine, string> = {
  seedance: "seedance2_fast",
  veo: "veo31_lite",
};

/** Display label for a Reels Creator engine chip / success summary. */
export function reelsEngineLabel(engine: ReelsEngine): string {
  return REELS_ENGINES.find((e) => e.id === engine)?.label ?? engine;
}

// ---------------------------------------------------------------------------
// Pricing + duration helpers (shared math so the cost label matches the charge).
// ---------------------------------------------------------------------------

/** Resolve the v2 pricing key the route bills with, by engine + resolution. */
export function reelsPricingKey(engine: ReelsEngine, resolution: string): string {
  return engine === "veo" ? veoPricingKey(resolution) : seedancePricingKey(resolution);
}

/** Total billed/produced seconds for a given engine/mode selection. */
export function reelsTotalDurationSec(args: {
  engine: ReelsEngine;
  mode?: ReelsVeoMode;
  durationPerScene?: number;
  numScenes?: number;
  veoDuration?: number;
}): number {
  if (args.engine === "seedance") {
    const n = Math.max(1, Number(args.numScenes) || 1);
    const d = Math.max(1, Number(args.durationPerScene) || 5);
    return n * d;
  }
  const d = Math.max(1, Number(args.veoDuration) || 6);
  if (args.mode === "perScene") {
    const n = Math.min(3, Math.max(1, Number(args.numScenes) || 1));
    return d * n;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Request validation / normalization.
// ---------------------------------------------------------------------------
export type ValidatedSeedanceRequest = {
  engine: "seedance";
  theme: string;
  numScenes: number;
  durationPerScene: number;
  resolution: SeedanceResolution;
  voiceId: string;
  emotion: string;
  style: CaptionStyle;
  totalDuration: number;
  jobType: "reels_seedance";
  jobTool: "reels";
  creationTool: "reels_seedance";
};

export type ValidatedVeoRequest = {
  engine: "veo";
  mode: ReelsVeoMode;
  theme: string;
  duration: number;
  resolution: VeoResolution;
  voiceId: string;
  emotion: MinimaxEmotion;
  style: CaptionStyle;
  singlePromptScenes?: number;
  numScenes?: number;
  totalDuration: number;
  jobType: "veo_single" | "veo_perscene";
  jobTool: "veo";
  creationTool: "reels_veo";
};

export type ValidatedReelsRequest = ValidatedSeedanceRequest | ValidatedVeoRequest;

export type ReelsValidationResult =
  | { ok: true; value: ValidatedReelsRequest }
  | { ok: false; status: number; error: string };

function coerceToSet<T extends number>(value: number, set: readonly T[], fallback: T): T {
  return (set as readonly number[]).includes(value) ? (value as T) : fallback;
}

function normalizeStyle(raw: unknown): CaptionStyle {
  if (raw && typeof raw === "object") {
    return raw as CaptionStyle;
  }
  return DEFAULT_CAPTION_STYLE;
}

/**
 * Validate + normalize a `/api/generate-reels` request body. Seedance fields are
 * coerced to the nearest valid option (the composer only ever sends valid ones);
 * Veo fields are validated strictly (mirroring the old Veo route) so an invalid
 * resolution/duration/mode is a clean 400 rather than a silently wrong charge.
 */
export function validateReelsRequest(body: unknown): ReelsValidationResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const engine = String(b.engine || "").toLowerCase();
  const theme = String(b.theme || "").trim();
  if (!theme) return { ok: false, status: 400, error: "Theme is required" };

  const style = normalizeStyle(b.captionStyle);
  const voiceId =
    typeof b.voiceId === "string" && b.voiceId ? b.voiceId : DEFAULT_VOICE_ID;

  if (engine === "seedance") {
    const numScenes = coerceToSet(Number(b.numScenes), SEEDANCE_SCENE_COUNTS, 1);
    const durationPerScene = coerceToSet(Number(b.durationPerScene), SEEDANCE_DURATIONS, 5);
    const resolution: SeedanceResolution = b.resolution === "720p" ? "720p" : "480p";
    // Seedance resolves "auto" against the LLM-suggested narrator emotion.
    const emotion = String(b.emotion || "auto").toLowerCase();
    return {
      ok: true,
      value: {
        engine: "seedance",
        theme,
        numScenes,
        durationPerScene,
        resolution,
        voiceId,
        emotion,
        style,
        totalDuration: numScenes * durationPerScene,
        jobType: "reels_seedance",
        jobTool: "reels",
        creationTool: "reels_seedance",
      },
    };
  }

  if (engine === "veo") {
    const modeStr = String(b.mode || "").trim().toLowerCase();
    const isSingle = modeStr === "single";
    const isPerScene = modeStr === "perscene";
    if (!isSingle && !isPerScene) {
      return { ok: false, status: 400, error: 'mode must be "single" or "perScene"' };
    }
    const duration = Number(b.duration);
    if (![4, 6, 8].includes(duration)) {
      return { ok: false, status: 400, error: "duration must be 4, 6, or 8" };
    }
    const resolution = String(b.resolution || "");
    if (resolution !== "720p" && resolution !== "1080p") {
      return { ok: false, status: 400, error: 'resolution must be "720p" or "1080p"' };
    }
    if (resolution === "1080p" && duration !== 8) {
      return {
        ok: false,
        status: 400,
        error: "1080p requires 8 second duration (Veo 3.1 Lite API constraint).",
      };
    }
    // Resolve narration mood server-side: "auto"/invalid -> "neutral" (Veo has no
    // LLM-suggested emotion; this matches the old client-side auto->neutral map).
    const eRaw = String(b.emotion || "").toLowerCase().trim();
    const emotion: MinimaxEmotion = (MINIMAX_EMOTIONS as readonly string[]).includes(eRaw)
      ? (eRaw as MinimaxEmotion)
      : "neutral";

    if (isSingle) {
      const singlePromptScenes = Number(b.singlePromptScenes);
      if (![1, 2].includes(singlePromptScenes)) {
        return {
          ok: false,
          status: 400,
          error: "singlePromptScenes must be 1 or 2 in single mode",
        };
      }
      return {
        ok: true,
        value: {
          engine: "veo",
          mode: "single",
          theme,
          duration,
          resolution,
          voiceId,
          emotion,
          style,
          singlePromptScenes,
          totalDuration: duration,
          jobType: "veo_single",
          jobTool: "veo",
          creationTool: "reels_veo",
        },
      };
    }

    const numScenes = Math.min(3, Math.max(1, Number(b.numScenes) || 1));
    return {
      ok: true,
      value: {
        engine: "veo",
        mode: "perScene",
        theme,
        duration,
        resolution,
        voiceId,
        emotion,
        style,
        numScenes,
        totalDuration: numScenes * duration,
        jobType: "veo_perscene",
        jobTool: "veo",
        creationTool: "reels_veo",
      },
    };
  }

  return { ok: false, status: 400, error: 'engine must be "seedance" or "veo"' };
}
