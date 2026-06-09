import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { updateToolConfig } from "@/lib/tool-configs-db";
import { validateToolPatch } from "@/lib/admin-config-validation";

// Update a tool config by tool_key (admin only). `enabled=false` now blocks the
// mapped generation API routes at runtime (Phase Admin 2); `visible_in_sidebar`
// only shows/hides the sidebar link. Validation is shared with the reset endpoint
// via lib/admin-config-validation.ts. Runtime changes may take up to ~60s (cache).
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

    const result = validateToolPatch(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    if (Object.keys(result.patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const tool = await updateToolConfig(params.tool_key, result.patch, ctx.profile.id);
    if (!tool) {
      return NextResponse.json({ error: "Tool config not found." }, { status: 404 });
    }
    return NextResponse.json({ tool, warnings: result.warnings });
  });
}
