import { listToolConfigs, type ToolConfig } from "@/lib/tool-configs-db";

/**
 * Runtime tool-access guard (Admin Phase 2).
 *
 * `tool_configs.enabled` now controls runtime access to a tool's generation
 * route (in addition to its Phase 1 sidebar-visibility role, which stays
 * UI-only). The guard is FAIL-OPEN: a missing row or a failed query never blocks
 * generation, to avoid an accidental outage from a config/DB problem.
 *
 * Route -> tool_key mapping (coarse; veo/storyboard are engines inside the Reels
 * tool, which is the only seeded tool_config that covers them):
 *   generate-reels, generate-storyboard, generate-storyboard-video -> reels
 *   generate-photo -> photo
 *   generate-caption -> schedule
 */

const CACHE_TTL_MS = 60_000;

type ToolCache = {
  map: Map<string, ToolConfig> | null;
  expiresAt: number;
};

let cache: ToolCache = { map: null, expiresAt: 0 };

/** Thrown when a tool is explicitly disabled in tool_configs. */
export class ToolDisabledError extends Error {
  readonly code = "TOOL_DISABLED";
  constructor(public readonly toolKey: string, message = "This tool is currently disabled.") {
    super(message);
    this.name = "ToolDisabledError";
  }
}

async function getToolMap(): Promise<Map<string, ToolConfig> | null> {
  const now = Date.now();
  if (cache.map && now < cache.expiresAt) return cache.map;

  try {
    const rows = await listToolConfigs();
    const map = new Map<string, ToolConfig>();
    for (const row of rows) map.set(row.tool_key, row);
    cache = { map, expiresAt: now + CACHE_TTL_MS };
    return map;
  } catch (e) {
    console.warn("[tool-access] DB read failed, failing open (tool treated as enabled):", e);
    return null;
  }
}

/** Fetch a single tool config, or null on miss/error. Never throws. */
export async function getToolConfig(toolKey: string): Promise<ToolConfig | null> {
  const map = await getToolMap();
  return map?.get(toolKey) ?? null;
}

/**
 * Throw ToolDisabledError ONLY when a tool_configs row exists and enabled=false.
 * Missing row or query error -> fail open (returns without throwing).
 */
export async function assertToolEnabled(toolKey: string): Promise<void> {
  const cfg = await getToolConfig(toolKey);
  if (cfg && cfg.enabled === false) {
    throw new ToolDisabledError(toolKey);
  }
}
