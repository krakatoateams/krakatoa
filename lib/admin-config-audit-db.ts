import { supabaseServer } from "@/lib/supabase-server";
import { errorLogSafe } from "@/lib/error-log-safe";

/**
 * Admin config audit trail (migration 117). Best-effort: a missing table or a failed
 * insert is logged and never blocks the config change itself.
 */
export async function recordProviderChange(params: {
  actorProfileId: string;
  toolKey: string;
  configKey: string;
  from: string;
  to: string;
}): Promise<void> {
  if (params.from === params.to) return;
  try {
    const { error } = await supabaseServer.from("admin_config_audit_log").insert({
      actor_profile_id: params.actorProfileId,
      action: "provider_switch",
      tool_key: params.toolKey,
      config_key: params.configKey,
      from_value: params.from,
      to_value: params.to,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn("[admin-audit] provider switch not recorded:", errorLogSafe(e));
  }
}

/** Model enable/disable and per-feature model changes. Same best-effort contract as above. */
export async function recordModelConfigChange(params: {
  actorProfileId: string;
  action: "model_enable" | "model_disable" | "feature_model_update";
  toolKey: string;
  /** modelId, or featureKey:modelId for feature rows. */
  modelId: string;
  before: Record<string, boolean>;
  after: Record<string, boolean>;
}): Promise<void> {
  try {
    const { error } = await supabaseServer.from("admin_config_audit_log").insert({
      actor_profile_id: params.actorProfileId,
      action: params.action,
      tool_key: params.toolKey,
      config_key: params.modelId,
      from_value: JSON.stringify(params.before),
      to_value: JSON.stringify(params.after),
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn("[admin-audit] model change not recorded:", errorLogSafe(e));
  }
}
