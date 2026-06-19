import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { ensureFeatureModelRows } from "@/lib/feature-model-configs-db";

// List per-feature model enablement (admin only). Materializes any missing rows
// from the code catalog first so the panel always shows the complete matrix,
// including newly added model tiers. No secrets are stored or returned.
export const dynamic = "force-dynamic";

export async function GET() {
  return withAdmin(async () => {
    const featureModels = await ensureFeatureModelRows();
    return NextResponse.json({ featureModels });
  });
}
