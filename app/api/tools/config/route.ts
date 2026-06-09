import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/profiles-db";
import { listToolConfigs } from "@/lib/tool-configs-db";

// Tool visibility for the authenticated sidebar/dashboard. Any signed-in user
// may read this. It returns only what the UI needs to decide visibility — it is
// NOT an access-control boundary (hiding is cosmetic in Phase Admin 1).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const tools = await listToolConfigs();
    return NextResponse.json({
      tools: tools.map((t) => ({
        tool_key: t.tool_key,
        display_name: t.display_name,
        enabled: t.enabled,
        visible_in_sidebar: t.visible_in_sidebar,
        sort_order: t.sort_order,
      })),
    });
  } catch (e) {
    console.error("[tools/config] failed:", e);
    return NextResponse.json({ error: "Failed to load tool config." }, { status: 500 });
  }
}
