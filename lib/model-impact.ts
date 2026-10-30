import { FAL_PHOTO_MODELS } from "@/lib/ai-providers/fal-photo-catalog";
import { labelsFor, type RegistryModel, type RegistryModelConfigRow } from "@/lib/model-registry";

/**
 * Impact preview of removing (archiving) a model. Read-only by construction: the reads interface
 * has only counting/listing methods. Counts are admin aggregates: no user ids, no media.
 * `jobs.model` / `assets.model` / `usage_events.model` store PROVIDER slugs, not catalog ids, so the
 * counts run over every slug the model has used. generation_predictions has no model column and is
 * not counted.
 */

export type ImpactCountScope = { table: "jobs" | "assets" | "usage_events"; sinceIso?: string; inFlight?: boolean };

export type ModelImpactReads = {
  /** Exact head count of rows whose `model` is in `slugs`; null when the read failed. */
  count(slugs: string[], scope: ImpactCountScope): Promise<number | null>;
  /** skill_configs designating this catalog model id; null when unreadable. */
  skillsDesignating(modelId: string): Promise<string[] | null>;
};

const DAY_MS = 86_400_000;

/** Every provider slug a catalog model may have stored on jobs, assets and usage events. */
export function providerSlugsFor(
  toolKey: "photo" | "reels",
  modelId: string,
  modelConfigs: readonly RegistryModelConfigRow[]
): string[] {
  const { providerModel, modelRole } = labelsFor(toolKey, modelId);
  const slugs = new Set<string>();
  if (providerModel) slugs.add(providerModel);
  if (modelRole) {
    const current = modelConfigs.find((r) => r.tool_key === toolKey && r.config_key === modelRole);
    if (current?.model) slugs.add(current.model);
    for (const [slug, fal] of Object.entries(FAL_PHOTO_MODELS)) if (fal.configKey === modelRole) slugs.add(slug);
  }
  return [...slugs];
}

export type ModelImpact = {
  modelId: string;
  toolKey: "photo" | "reels";
  /** Guard result for Remove: reasons when blocked. */
  archiveCheck: RegistryModel["archiveCheck"];
  enabledIn: RegistryModel["enabledIn"];
  defaultIn: RegistryModel["defaultIn"];
  reelsEngine: RegistryModel["reelsEngine"];
  skills: string[] | null;
  /** Pricing keys that stay untouched. */
  pricingKeys: string[];
  slugs: string[];
  counts: {
    inFlightJobs: number | null;
    jobs: { last30Days: number | null; allTime: number | null };
    assets: { last30Days: number | null; allTime: number | null };
    usageEvents: { last30Days: number | null; allTime: number | null };
  };
};

export async function buildModelImpact(input: {
  model: RegistryModel;
  modelConfigs: readonly RegistryModelConfigRow[];
  reads: ModelImpactReads;
  now?: number;
}): Promise<ModelImpact> {
  const { model, reads } = input;
  const slugs = providerSlugsFor(model.toolKey, model.modelId, input.modelConfigs);
  const sinceIso = new Date((input.now ?? Date.now()) - 30 * DAY_MS).toISOString();
  const safe = <T,>(p: Promise<T | null>): Promise<T | null> => p.catch(() => null);
  const pair = async (table: ImpactCountScope["table"]) => {
    const [last30Days, allTime] = await Promise.all([
      safe(reads.count(slugs, { table, sinceIso })),
      safe(reads.count(slugs, { table })),
    ]);
    return { last30Days, allTime };
  };
  const [inFlightJobs, jobs, assets, usageEvents, skills] = await Promise.all([
    safe(reads.count(slugs, { table: "jobs", inFlight: true })),
    pair("jobs"),
    pair("assets"),
    pair("usage_events"),
    safe(reads.skillsDesignating(model.modelId)),
  ]);
  return {
    modelId: model.modelId,
    toolKey: model.toolKey,
    archiveCheck: model.archiveCheck,
    enabledIn: model.enabledIn,
    defaultIn: model.defaultIn,
    reelsEngine: model.reelsEngine,
    skills,
    pricingKeys: model.pricing.keys.map((k) => k.key),
    slugs,
    counts: { inFlightJobs, jobs, assets, usageEvents },
  };
}
