import { NextResponse } from "next/server";
import { listToolConfigs } from "@/lib/tool-configs-db";

// Tool visibility for the sidebar/dashboard, logged in or not — a logged-out
// visitor browsing the public dashboard (kelolako-dashboard-nonlogin-plan)
// needs to see the same coming-soon badge a signed-in user would. Returns
// only what the UI needs to decide visibility (no user data) — it is NOT an
// access-control boundary; that lives in app/(app)/tools/scheduler/page.tsx
// and .../calendar/page.tsx (coming_soon) and lib/tool-access.ts (enabled +
// generation routes), both server-side.
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
