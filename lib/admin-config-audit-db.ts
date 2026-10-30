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
