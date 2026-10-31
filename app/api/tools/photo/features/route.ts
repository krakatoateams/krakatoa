import { NextResponse } from "next/server";
import { isModelStateUnavailable, modelStateUnavailableResponse } from "@/lib/model-state-unavailable";
import { getCurrentProfile } from "@/lib/profiles-db";
import { PHOTO_FEATURES } from "@/lib/creation-features";
import { getPhotoFeatureEnablement } from "@/lib/feature-model-configs-db";

/**
 * Per-feature enabled models for the Photo omni-form (/tools/photo-v2).
 *
 * Any signed-in user may read this. It returns, per creation feature, the set of
 * model tiers an admin has enabled and the default tier. The omni-form intersects
 * this with the in-code capability rules (e.g. only reference-capable models can
 * appear in Product try-on). Fails closed: 503 (retryable) when the admin state cannot be read.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const enablement = await getPhotoFeatureEnablement();
    return NextResponse.json({
      features: PHOTO_FEATURES.map((f) => ({
        key: f.key,
        label: f.label,
        description: f.description,
        enabledTiers: enablement[f.key]?.enabledTiers ?? [],
        defaultTier: enablement[f.key]?.defaultTier ?? null,
      })),
    });
  } catch (e) {
    if (isModelStateUnavailable(e)) return modelStateUnavailableResponse();
    console.error("[tools/photo/features] failed:", e);
    return NextResponse.json({ error: "Failed to load photo features." }, { status: 500 });
  }
}
