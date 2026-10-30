import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { ensureModelCatalogRows } from "@/lib/model-catalog-configs-db";
import { ensureFeatureModelRows } from "@/lib/feature-model-configs-db";
import { listPricingConfigs } from "@/lib/pricing-configs-db";
import { listModelConfigs } from "@/lib/model-configs-db";
import { generationErrorLogSafe } from "@/lib/error-log-safe";
import { buildModelRegistry } from "@/lib/model-registry";

export const dynamic = "force-dynamic";

/** Optional reads degrade to "shipped defaults" (what the runtime does) instead of a 500. */
async function tolerant<T>(label: string, read: () => Promise<T>, fallback: T, notes: string[]): Promise<T> {
  try {
    return await read();
  } catch (e) {
    console.warn(`[model-registry] ${label} unavailable:`, generationErrorLogSafe(e));
    notes.push(`${label} could not be read; showing shipped defaults for it.`);
    return fallback;
  }
}

/** Read-only registry of every code-catalog generation model. Admin only; boolean provider flags, no secrets. */
export async function GET() {
  return withAdmin(async () => {
    const notes: string[] = [];
    const [catalogRows, featureRows, pricingRows, modelConfigs] = await Promise.all([
      tolerant("Model catalog", ensureModelCatalogRows, [], notes),
      tolerant("Feature model settings", ensureFeatureModelRows, [], notes),
      tolerant("Pricing", () => listPricingConfigs(), [], notes),
      tolerant("Provider settings", listModelConfigs, [], notes),
    ]);
    const models = buildModelRegistry({ catalogRows, featureRows, pricingRows, modelConfigs });
    return NextResponse.json({ models, notes });
  });
}
