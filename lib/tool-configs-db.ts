import { supabaseServer } from "@/lib/supabase-server";

/**
 * Tool configs data access (service-role).
 *
 * Controls which tools are enabled / visible in the dashboard sidebar. In Phase
 * Admin 1 this drives sidebar visibility only (cosmetic). Direct route access to
 * a disabled tool is NOT blocked yet — that is a later, deliberate step.
 */

export type ToolConfig = {
  id: string;
  tool_key: string;
  display_name: string;
  enabled: boolean;
  visible_in_sidebar: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
  updated_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

const TOOL_CONFIGS_TABLE = "tool_configs";

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (
    error.message.includes("tool_configs") &&
    (error.message.includes("schema cache") ||
      error.message.includes("does not exist"))
  ) {
    throw new Error(
      "Database table tool_configs is missing. Run: npm run db:setup — or apply supabase/migrations/007_admin_panel.sql."
    );
  }
  throw new Error(error.message || fallback);
}

/** List all tool configs ordered by sort_order. */
export async function listToolConfigs(): Promise<ToolConfig[]> {
  const { data, error } = await supabaseServer
    .from(TOOL_CONFIGS_TABLE)
    .select("*")
    .order("sort_order", { ascending: true });

  handleError(error, "Failed to list tool configs.");
  return (data as ToolConfig[] | null) ?? [];
}

export type ToolConfigPatch = {
  display_name?: string;
  enabled?: boolean;
  visible_in_sidebar?: boolean;
  sort_order?: number;
  metadata?: Record<string, unknown>;
};

/** Update a single tool config by tool_key. Returns the updated row or null. */
export async function updateToolConfig(
  toolKey: string,
  patch: ToolConfigPatch,
  updatedByProfileId: string | null
): Promise<ToolConfig | null> {
  const update: Record<string, unknown> = { updated_by_profile_id: updatedByProfileId };
  if (patch.display_name !== undefined) update.display_name = patch.display_name;
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.visible_in_sidebar !== undefined)
    update.visible_in_sidebar = patch.visible_in_sidebar;
  if (patch.sort_order !== undefined) update.sort_order = patch.sort_order;
  if (patch.metadata !== undefined) update.metadata = patch.metadata;

  const { data, error } = await supabaseServer
    .from(TOOL_CONFIGS_TABLE)
    .update(update)
    .eq("tool_key", toolKey)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to update tool config.");
  return (data as ToolConfig | null) ?? null;
}
