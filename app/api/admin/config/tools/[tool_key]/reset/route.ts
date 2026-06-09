import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { updateToolConfig } from "@/lib/tool-configs-db";
import { getToolDefault } from "@/lib/admin-config-defaults";
import { validateToolPatch } from "@/lib/admin-config-validation";

// Reset a tool config to its canonical default (Admin Phase 2.5).
// Admin-gated. Updates the existing row via the shared helper (records
// updated_by_profile_id). The default is run through the same validator the
// PATCH route uses, so reset can never bypass validation.
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { tool_key: string } }
) {
  return withAdmin(async (ctx) => {
    const def = getToolDefault(params.tool_key);
    if (!def) {
      return NextResponse.json(
        { error: "No canonical default exists for this tool key." },
        { status: 404 }
      );
    }

    const result = validateToolPatch({
      display_name: def.display_name,
      enabled: def.enabled,
      visible_in_sidebar: def.visible_in_sidebar,
      sort_order: def.sort_order,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const tool = await updateToolConfig(params.tool_key, result.patch, ctx.profile.id);
    if (!tool) {
      return NextResponse.json({ error: "Tool config not found." }, { status: 404 });
    }
    return NextResponse.json({ tool, warnings: result.warnings, reset: true });
  });
}
