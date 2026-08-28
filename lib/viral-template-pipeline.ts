import { resolveProviderFetchableOrigin } from "@/lib/http";
import { isViralTemplateAssetPath } from "@/lib/trending-templates";

/** Replicate-fetchable URL for a bundled viral-template still (never localhost). */
export function viralTemplateAssetUrlForProvider(assetPath: string): string | null {
  const trimmed = assetPath.trim();
  if (!isViralTemplateAssetPath(trimmed)) return null;
  return `${resolveProviderFetchableOrigin().replace(/\/$/, "")}${trimmed}`;
}

/** Rewrite loopback viral-template first-frame URLs before sending to Replicate. */
export function rewriteViralTemplateFirstFrameUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!isViralTemplateAssetPath(parsed.pathname)) return null;
    return viralTemplateAssetUrlForProvider(parsed.pathname);
  } catch {
    if (isViralTemplateAssetPath(url)) return viralTemplateAssetUrlForProvider(url);
    return null;
  }
}
