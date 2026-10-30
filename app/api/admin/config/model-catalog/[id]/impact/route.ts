import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { ensureModelCatalogRows, archiveColumnAvailable } from "@/lib/model-catalog-configs-db";
import { ensureFeatureModelRows } from "@/lib/feature-model-configs-db";
import { listPricingConfigs } from "@/lib/pricing-configs-db";
import { listModelConfigs } from "@/lib/model-configs-db";
import { buildModelRegistry } from "@/lib/model-registry";
import { buildModelImpact } from "@/lib/model-impact";
import { dbModelImpactReads } from "@/lib/model-impact-db";

// Read-only dry run of "Remove this model" (admin only): guard result, where it is used, and bounded
// counts. Writes nothing; returns no user ids or media.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return withAdmin(async () => {
    const [catalogRows, featureRows, pricingRows, modelConfigs, archiveAvailable] = await Promise.all([
      ensureModelCatalogRows(),
      ensureFeatureModelRows(),
      listPricingConfigs(),
      listModelConfigs(),
      archiveColumnAvailable(),
    ]);
    const row = catalogRows.find((r) => r.id === params.id);
    if (!row) return NextResponse.json({ error: "Model catalog config not found." }, { status: 404 });
    const model = buildModelRegistry({ catalogRows, featureRows, pricingRows, modelConfigs }).find(
      (m) => m.toolKey === row.tool_key && m.modelId === row.model_id
    );
    if (!model) return NextResponse.json({ error: "This model is not in the code catalog." }, { status: 409 });
    const impact = await buildModelImpact({ model, modelConfigs, reads: dbModelImpactReads });
    return NextResponse.json({ impact, archiveAvailable });
  });
}
