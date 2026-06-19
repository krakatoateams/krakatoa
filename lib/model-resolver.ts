import { listModelConfigs, type ModelConfig } from "@/lib/model-configs-db";
import {
  getProductPhotoTier,
  type ProductPhotoModelTier,
} from "@/lib/product-photo";

/**
 * Runtime model resolver (Admin Phase 2).
 *
 * Reads admin-editable `model_configs` and returns provider/model/parameters,
 * falling back to the canonical hardcoded model IDs whenever the DB row is
 * missing, disabled, malformed, or the query fails.
 *
 * Guarantees:
 *   - NEVER throws.
 *   - DB value used only when enabled=true and provider/model are non-empty strings.
 *   - Returns only safe fields (provider, model, parameters). No secrets/API keys
 *     are stored or returned; keys remain in environment variables.
 *   - The SAME resolved value should be reused by callers for the provider call,
 *     createJob, createProcessingAsset, and recordUsageEvent so logs match reality.
 */

export type ResolvedModel = {
  provider: string;
  model: string;
  parameters: Record<string, unknown>;
};

/**
 * Replicate model reference shape ("owner/name" or "owner/name:version"), matching
 * the branded parameter type the Replicate SDK wrappers expect. Assignable to a
 * plain string, so it also satisfies the looser wrappers.
 */
export type ReplicateModelRef =
  | `${string}/${string}`
  | `${string}/${string}:${string}`;

const CACHE_TTL_MS = 60_000;

type ModelCache = {
  map: Map<string, ModelConfig> | null;
  expiresAt: number;
};

let cache: ModelCache = { map: null, expiresAt: 0 };

function key(toolKey: string, configKey: string): string {
  return `${toolKey}.${configKey}`;
}

/** Cached map of model_configs by `${tool_key}.${config_key}`, or null on error. */
async function getModelMap(): Promise<Map<string, ModelConfig> | null> {
  const now = Date.now();
  if (cache.map && now < cache.expiresAt) return cache.map;

  try {
    const rows = await listModelConfigs();
    const map = new Map<string, ModelConfig>();
    for (const row of rows) map.set(key(row.tool_key, row.config_key), row);
    cache = { map, expiresAt: now + CACHE_TTL_MS };
    return map;
  } catch (e) {
    console.warn("[model-resolver] DB read failed, using fallback model IDs:", e);
    return null;
  }
}

function isUsable(cfg: ModelConfig | null | undefined): cfg is ModelConfig {
  return Boolean(
    cfg &&
      cfg.enabled &&
      typeof cfg.provider === "string" &&
      cfg.provider.trim().length > 0 &&
      typeof cfg.model === "string" &&
      cfg.model.trim().length > 0
  );
}

/**
 * Resolve one model config with an explicit fallback. Never throws; always
 * returns a usable ResolvedModel.
 */
export async function resolveModel(params: {
  toolKey: string;
  configKey: string;
  fallback: ResolvedModel;
}): Promise<ResolvedModel> {
  try {
    const map = await getModelMap();
    const cfg = map?.get(key(params.toolKey, params.configKey)) ?? null;
    if (isUsable(cfg)) {
      return {
        provider: cfg.provider,
        model: cfg.model,
        parameters: cfg.parameters ?? {},
      };
    }
  } catch (e) {
    console.warn(
      `[model-resolver] '${params.toolKey}.${params.configKey}' lookup failed, using fallback:`,
      e
    );
  }
  return params.fallback;
}

/**
 * Build the Replicate model reference, appending a pinned version when present
 * in parameters.version (e.g. Whisper). Falls back to the bare model id (the
 * hardcoded fallback strings already embed their version hash where needed).
 */
export function replicateRef(resolved: ResolvedModel): ReplicateModelRef {
  const version = resolved.parameters?.version;
  if (typeof version === "string" && version.trim().length > 0) {
    return `${resolved.model}:${version}` as ReplicateModelRef;
  }
  return resolved.model as ReplicateModelRef;
}

// ---------------------------------------------------------------------------
// Canonical fallbacks (mirror the current hardcoded model IDs in the routes).
// ---------------------------------------------------------------------------
const REPLICATE = "replicate";
const WHISPER_PINNED =
  "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c";

const FALLBACKS = {
  reels: {
    llm: { provider: REPLICATE, model: "google/gemini-2.5-flash", parameters: {} },
    video: { provider: REPLICATE, model: "bytedance/seedance-2.0-fast", parameters: {} },
    tts: { provider: REPLICATE, model: "minimax/speech-02-turbo", parameters: {} },
    whisper: { provider: REPLICATE, model: WHISPER_PINNED, parameters: {} },
  },
  veo: {
    llm: { provider: REPLICATE, model: "google/gemini-2.5-flash", parameters: {} },
    video: { provider: REPLICATE, model: "google/veo-3.1-lite", parameters: {} },
    tts: { provider: REPLICATE, model: "minimax/speech-02-turbo", parameters: {} },
    whisper: { provider: REPLICATE, model: WHISPER_PINNED, parameters: {} },
  },
  storyboard: {
    scene_llm: { provider: REPLICATE, model: "openai/gpt-5", parameters: {} },
    image: { provider: REPLICATE, model: "openai/gpt-image-2", parameters: {} },
    video: { provider: REPLICATE, model: "bytedance/seedance-2.0-fast", parameters: {} },
  },
  photo: {
    // Legacy single-model role (config_key=image). Disabled/deprecated in
    // migration 011; kept only as a defensive fallback. Product Photo now uses
    // the per-tier roles below.
    image: { provider: REPLICATE, model: "google/nano-banana", parameters: {} },
    image_basic: { provider: REPLICATE, model: "google/nano-banana", parameters: {} },
    image_balanced: { provider: REPLICATE, model: "google/nano-banana-2", parameters: {} },
    image_pro: { provider: REPLICATE, model: "google/nano-banana-pro", parameters: {} },
  },
  render: {
    rendi: { provider: "rendi", model: "default", parameters: {} },
  },
} as const;

function fb(group: ResolvedModel): ResolvedModel {
  return { provider: group.provider, model: group.model, parameters: { ...group.parameters } };
}

/** Resolved models for the ReelsGen (Seedance) pipeline. */
export async function getReelsModels(): Promise<{
  llm: ResolvedModel;
  video: ResolvedModel;
  tts: ResolvedModel;
  whisper: ResolvedModel;
}> {
  const [llm, video, tts, whisper] = await Promise.all([
    resolveModel({ toolKey: "reels", configKey: "llm", fallback: fb(FALLBACKS.reels.llm) }),
    resolveModel({ toolKey: "reels", configKey: "video", fallback: fb(FALLBACKS.reels.video) }),
    resolveModel({ toolKey: "reels", configKey: "tts", fallback: fb(FALLBACKS.reels.tts) }),
    resolveModel({ toolKey: "reels", configKey: "whisper", fallback: fb(FALLBACKS.reels.whisper) }),
  ]);
  return { llm, video, tts, whisper };
}

/** Resolved models for the Veo pipeline. */
export async function getVeoModels(): Promise<{
  llm: ResolvedModel;
  video: ResolvedModel;
  tts: ResolvedModel;
  whisper: ResolvedModel;
}> {
  const [llm, video, tts, whisper] = await Promise.all([
    resolveModel({ toolKey: "veo", configKey: "llm", fallback: fb(FALLBACKS.veo.llm) }),
    resolveModel({ toolKey: "veo", configKey: "video", fallback: fb(FALLBACKS.veo.video) }),
    resolveModel({ toolKey: "veo", configKey: "tts", fallback: fb(FALLBACKS.veo.tts) }),
    resolveModel({ toolKey: "veo", configKey: "whisper", fallback: fb(FALLBACKS.veo.whisper) }),
  ]);
  return { llm, video, tts, whisper };
}

/** Resolved models for the storyboard pipeline (image + video share `storyboard`). */
export async function getStoryboardModels(): Promise<{
  sceneLlm: ResolvedModel;
  image: ResolvedModel;
  video: ResolvedModel;
}> {
  const [sceneLlm, image, video] = await Promise.all([
    resolveModel({
      toolKey: "storyboard",
      configKey: "scene_llm",
      fallback: fb(FALLBACKS.storyboard.scene_llm),
    }),
    resolveModel({
      toolKey: "storyboard",
      configKey: "image",
      fallback: fb(FALLBACKS.storyboard.image),
    }),
    resolveModel({
      toolKey: "storyboard",
      configKey: "video",
      fallback: fb(FALLBACKS.storyboard.video),
    }),
  ]);
  return { sceneLlm, image, video };
}

/**
 * @deprecated Use getPhotoModel(modelTier) instead (Product Photo v2.3 model
 * tiers). The legacy `photo.image` row is disabled/deprecated in migration 011.
 * Kept for backward compatibility only.
 */
export async function getPhotoModels(): Promise<{ image: ResolvedModel }> {
  const image = await resolveModel({
    toolKey: "photo",
    configKey: "image",
    fallback: fb(FALLBACKS.photo.image),
  });
  return { image };
}

/**
 * Resolve the Product Photo provider model for a tier (v2.3+).
 *
 * Each tier declares its own model_configs config_key (modelRole) and canonical
 * Replicate model id (providerModel). The fallback is built straight from the
 * tier definition, so adding a new model in lib/product-photo.ts automatically
 * resolves here — no per-role switch to maintain. An admin can still override any
 * tier via a model_configs row keyed on its modelRole.
 */
export async function getPhotoModel(
  modelTier: ProductPhotoModelTier
): Promise<ResolvedModel> {
  const tier = getProductPhotoTier(modelTier);
  return resolveModel({
    toolKey: "photo",
    configKey: tier.modelRole,
    fallback: { provider: REPLICATE, model: tier.providerModel, parameters: {} },
  });
}

/** Resolved Rendi render config (informational; routes keep the hardcoded URL). */
export async function getRenderConfig(): Promise<ResolvedModel> {
  return resolveModel({
    toolKey: "render",
    configKey: "rendi",
    fallback: fb(FALLBACKS.render.rendi),
  });
}
