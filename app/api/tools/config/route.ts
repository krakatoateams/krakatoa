import { NextResponse } from "next/server";
import { listToolConfigs } from "@/lib/tool-configs-db";

// Presentational tool flags (enabled / coming_soon / sidebar visibility).
// Public — the landing page and logged-out dashboard both need them. This is
// NOT an access-control boundary; generation routes still enforce tool_access
// server-side.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tools = await listToolConfigs();
    return NextResponse.json({
      tools: tools.map((t) => ({
        tool_key: t.tool_key,
        display_name: t.display_name,
        enabled: t.enabled,
        visible_in_sidebar: t.visible_in_sidebar,
        coming_soon: t.coming_soon,
        sort_order: t.sort_order,
      })),
    });
  } catch (e) {
    console.error("[tools/config] failed:", e);
    return NextResponse.json({ error: "Failed to load tool config." }, { status: 500 });
  }
}
