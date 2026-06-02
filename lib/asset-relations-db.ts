import { supabaseServer } from "@/lib/supabase-server";
import type { Asset } from "@/lib/assets-db";

export type RelationType =
  | "derived_from"
  | "thumbnail_of"
  | "caption_for"
  | "audio_for"
  | "storyboard_for"
  | "source_for"
  | "variant_of"
  | "contains";

export type AssetRelation = {
  id: string;
  profile_id: string;
  parent_asset_id: string;
  child_asset_id: string;
  relation_type: RelationType;
  metadata: Record<string, unknown>;
  created_at: string;
};

const ASSET_RELATIONS_TABLE = "asset_relations";

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (
    error.message.includes("asset_relations") &&
    error.message.includes("schema cache")
  ) {
    throw new Error(
      "Database table asset_relations is missing. Run: npm run db:setup — or apply supabase/migrations/003_platform_foundation_nextauth_single_user.sql."
    );
  }
  throw new Error(error.message || fallback);
}

/**
 * Link two assets (e.g. storyboard image -> generated video). Idempotent on
 * (parent, child, relation_type) thanks to the unique index — re-creating an
 * existing relation returns the existing row instead of throwing.
 */
export async function createAssetRelation(params: {
  profileId: string;
  parentAssetId: string;
  childAssetId: string;
  relationType: RelationType;
  metadata?: Record<string, unknown>;
}): Promise<AssetRelation> {
  const { data, error } = await supabaseServer
    .from(ASSET_RELATIONS_TABLE)
    .insert({
      profile_id: params.profileId,
      parent_asset_id: params.parentAssetId,
      child_asset_id: params.childAssetId,
      relation_type: params.relationType,
      metadata: params.metadata ?? {},
    })
    .select("*")
    .single();

  if (error && /duplicate key|unique/i.test(error.message)) {
    const { data: existing, error: fetchErr } = await supabaseServer
      .from(ASSET_RELATIONS_TABLE)
      .select("*")
      .eq("parent_asset_id", params.parentAssetId)
      .eq("child_asset_id", params.childAssetId)
      .eq("relation_type", params.relationType)
      .eq("profile_id", params.profileId)
      .maybeSingle();
    handleError(fetchErr, "Failed to fetch existing asset relation.");
    if (existing) return existing as AssetRelation;
  }

  handleError(error, "Failed to create asset relation.");
  return data as AssetRelation;
}

/**
 * List assets related to a given asset.
 *
 * - direction 'children' (default): assets where the given asset is the parent.
 * - direction 'parents': assets where the given asset is the child.
 *
 * Returns the joined Asset rows along with the relation metadata.
 */
export async function listRelatedAssets(
  profileId: string,
  assetId: string,
  options?: { direction?: "children" | "parents"; relationType?: RelationType }
): Promise<Array<{ relation: AssetRelation; asset: Asset }>> {
  const direction = options?.direction ?? "children";
  const matchColumn =
    direction === "children" ? "parent_asset_id" : "child_asset_id";
  const joinColumn =
    direction === "children" ? "child_asset_id" : "parent_asset_id";

  let relQuery = supabaseServer
    .from(ASSET_RELATIONS_TABLE)
    .select("*")
    .eq("profile_id", profileId)
    .eq(matchColumn, assetId);

  if (options?.relationType) {
    relQuery = relQuery.eq("relation_type", options.relationType);
  }

  const { data: relations, error: relError } = await relQuery;
  handleError(relError, "Failed to list asset relations.");

  const rels = (relations as AssetRelation[] | null) ?? [];
  if (rels.length === 0) return [];

  const relatedIds = Array.from(
    new Set(rels.map((r) => r[joinColumn as keyof AssetRelation] as string))
  );

  const { data: assets, error: assetError } = await supabaseServer
    .from("assets")
    .select("*")
    .eq("profile_id", profileId)
    .in("id", relatedIds);

  handleError(assetError, "Failed to fetch related assets.");

  const assetById = new Map<string, Asset>(
    ((assets as Asset[] | null) ?? []).map((a) => [a.id, a])
  );

  return rels
    .map((relation) => {
      const targetId = relation[joinColumn as keyof AssetRelation] as string;
      const asset = assetById.get(targetId);
      return asset ? { relation, asset } : null;
    })
    .filter((x): x is { relation: AssetRelation; asset: Asset } => x !== null);
}
