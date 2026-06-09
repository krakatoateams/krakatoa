import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { updateToolConfig, type ToolConfigPatch } from "@/lib/tool-configs-db";

// Update a tool config by tool_key (admin only). Controls sidebar visibility +
// enable flag. In Phase Admin 1 this affects the sidebar only (cosmetic).
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { tool_key: string } }
) {
  return withAdmin(async (ctx) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const patch: ToolConfigPatch = {};
    if (typeof body.display_name === "string") patch.display_name = body.display_name;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.visible_in_sidebar === "boolean")
      patch.visible_in_sidebar = body.visible_in_sidebar;
    if (typeof body.sort_order === "number") patch.sort_order = body.sort_order;
    if (body.metadata && typeof body.metadata === "object")
      patch.metadata = body.metadata as Record<string, unknown>;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const tool = await updateToolConfig(params.tool_key, patch, ctx.profile.id);
    if (!tool) {
      return NextResponse.json({ error: "Tool config not found." }, { status: 404 });
    }
    return NextResponse.json({ tool });
  });
}
