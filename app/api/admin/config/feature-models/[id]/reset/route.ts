import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { resetFeatureModelConfig } from "@/lib/feature-model-configs-db";

// Reset a per-feature model row to its shipped code default (enabled=true; the
// default flag follows lib/creation-features.ts). Admin only.
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withAdmin(async (ctx) => {
    const featureModel = await resetFeatureModelConfig(params.id, ctx.profile.id);
    if (!featureModel) {
      return NextResponse.json({ error: "Feature model config not found." }, { status: 404 });
    }
    return NextResponse.json({ featureModel });
  });
}
