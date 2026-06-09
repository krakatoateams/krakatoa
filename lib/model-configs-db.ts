import { supabaseServer } from "@/lib/supabase-server";

/**
 * Model configs data access (service-role).
 *
 * Stores provider/model identifiers + safe parameters per tool. SECURITY: never
 * store API keys/secrets here — they stay in environment variables. The admin UI
 * may edit model IDs and safe parameters, but cannot read or write secrets.
 *
 * PHASE ADMIN 1: generation routes DO NOT read these values yet — they still use
 * their hardcoded model IDs. Phase Admin 2 will add a model resolver that reads
 * this table WITH a fallback to those literals.
 */

export type ModelConfig = {
  id: string;
  tool_key: string;
  config_key: string;
  provider: string;
  model: string;
  enabled: boolean;
  is_default: boolean;
  parameters: Record<string, unknown>;
  metadata: Record<string, unknown>;
  updated_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

const MODEL_CONFIGS_TABLE = "model_configs";

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (
    error.message.includes("model_configs") &&
    (error.message.includes("schema cache") ||
      error.message.includes("does not exist"))
  ) {
    throw new Error(
      "Database table model_configs is missing. Run: npm run db:setup — or apply supabase/migrations/007_admin_panel.sql."
    );
  }
  throw new Error(error.message || fallback);
}

/** List all model configs ordered by tool_key, config_key. */
export async function listModelConfigs(): Promise<ModelConfig[]> {
  const { data, error } = await supabaseServer
    .from(MODEL_CONFIGS_TABLE)
    .select("*")
    .order("tool_key", { ascending: true })
    .order("config_key", { ascending: true });

  handleError(error, "Failed to list model configs.");
  return (data as ModelConfig[] | null) ?? [];
}

export type ModelConfigPatch = {
  provider?: string;
  model?: string;
  enabled?: boolean;
  is_default?: boolean;
  parameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

/**
 * Update a single model config by id. Only safe fields are accepted; there is no
 * column for secrets, so this can never expose or mutate API keys.
 */
export async function updateModelConfig(
  id: string,
  patch: ModelConfigPatch,
  updatedByProfileId: string | null
): Promise<ModelConfig | null> {
  const update: Record<string, unknown> = { updated_by_profile_id: updatedByProfileId };
  if (patch.provider !== undefined) update.provider = patch.provider;
  if (patch.model !== undefined) update.model = patch.model;
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.is_default !== undefined) update.is_default = patch.is_default;
  if (patch.parameters !== undefined) update.parameters = patch.parameters;
  if (patch.metadata !== undefined) update.metadata = patch.metadata;

  const { data, error } = await supabaseServer
    .from(MODEL_CONFIGS_TABLE)
    .update(update)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to update model config.");
  return (data as ModelConfig | null) ?? null;
}
