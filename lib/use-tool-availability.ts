"use client";

import { useEffect, useState } from "react";
import { TOOL_DEFAULTS } from "@/lib/admin-config-defaults";
import { TOOL_CONFIG_UPDATED_EVENT } from "@/lib/tool-config-events";

export type ToolAvailability = {
  enabled: boolean;
  comingSoon: boolean;
  /** false until the first fetch resolves. */
  ready: boolean;
};

type ToolConfigRow = { tool_key: string; enabled: boolean; coming_soon: boolean };

/**
 * Client-side read of /api/tools/config, keyed by tool_key. Shared fetch
 * logic behind useToolAvailability (one tool) and useToolAvailabilityMap
 * (several at once, one request instead of N) — both used to gate UI outside
 * Sidebar.tsx, which already does its own equivalent fetch. Fails OPEN
 * (available) while loading or on fetch error — this is a UX nicety only,
 * never an access-control boundary; the real gate for a disabled tool is
 * lib/tool-access.ts server-side.
 */
function useToolConfigRows(): { rows: ToolConfigRow[] | null; ready: boolean } {
  const [rows, setRows] = useState<ToolConfigRow[] | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/tools/config")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { tools?: ToolConfigRow[] } | null) => {
          if (cancelled) return;
          if (data?.tools) setRows(data.tools);
          setReady(true);
        })
        .catch(() => {
          if (!cancelled) setReady(true);
        });
    };
    load();
    window.addEventListener(TOOL_CONFIG_UPDATED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(TOOL_CONFIG_UPDATED_EVENT, load);
    };
  }, []);

  return { rows, ready };
}

function availabilityOf(
  toolKey: string,
  rows: ToolConfigRow[] | null,
  ready: boolean
): ToolAvailability {
  const tool = rows?.find((t) => t.tool_key === toolKey);
  const def = TOOL_DEFAULTS[toolKey];
  return {
    enabled: tool ? tool.enabled : (def?.enabled ?? true),
    // Missing row: honour the code default (e.g. virtual_creator is Soon)
    // instead of failing open as "not coming soon".
    comingSoon: tool ? tool.coming_soon : (def?.coming_soon ?? false),
    ready,
  };
}

/** Single tool's enabled/coming_soon state — e.g. Photo/Video's "Schedule this post" CTA. */
export function useToolAvailability(toolKey: string): ToolAvailability {
  const { rows, ready } = useToolConfigRows();
  return availabilityOf(toolKey, rows, ready);
}

/** Several tools at once, keyed by tool_key — e.g. the dashboard's tool grid. */
export function useToolAvailabilityMap(): {
  map: Record<string, ToolAvailability>;
  ready: boolean;
} {
  const { rows, ready } = useToolConfigRows();
  const keys = new Set([
    ...Object.keys(TOOL_DEFAULTS),
    ...(rows ?? []).map((t) => t.tool_key),
  ]);
  const map = Object.fromEntries(
    [...keys].map((key) => [key, availabilityOf(key, rows, ready)])
  );
  return { map, ready };
}
