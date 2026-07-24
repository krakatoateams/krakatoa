import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/profiles-db";
import { getVideoComposerEnablement } from "@/lib/feature-model-configs-db";
import { VIDEO_COMPOSER_FEATURES } from "@/lib/video-composer-features";

/**
 * Per-composer enabled models for the Video studio (/tools/video).
 *
 * Any signed-in user may read this. Returns, per composer, the set of model ids
 * an admin has enabled and the default model. The studio intersects this with
 * in-code capability rules. Never throws — falls back to code defaults when DB
 * is unavailable.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const enablement = await getVideoComposerEnablement();
    return NextResponse.json({
      composers: VIDEO_COMPOSER_FEATURES.map((c) => ({
        key: c.key,
        label: c.label,
        enabledModelIds: enablement[c.key]?.enabledTiers ?? [],
        defaultModelId: enablement[c.key]?.defaultTier ?? null,
      })),
    });
  } catch (e) {
    console.error("[tools/video/features] failed:", e);
    return NextResponse.json({ error: "Failed to load video features." }, { status: 500 });
  }
}
