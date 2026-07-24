import { getUserCreationForUser } from "@/lib/creations-db";
import { resolveSignedMediaUrl } from "@/lib/storage-signed-url";
import type { MentionAssetKind, ResolvedMentionCreation } from "@/lib/mention-assets";

/** Owner-scoped lookup for @-mentioned or library-picked creations (server only). */
export async function resolveMentionCreations(
  userId: string,
  ids: string[]
): Promise<{ ok: true; items: ResolvedMentionCreation[] } | { ok: false; error: string }> {
  const unique = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  const items: ResolvedMentionCreation[] = [];
  for (const id of unique) {
    const creation = await getUserCreationForUser(userId, id);
    if (!creation?.mediaUrl && !creation?.storagePath) {
      return { ok: false, error: "A mentioned asset could not be found." };
    }
    const signedUrl = await resolveSignedMediaUrl({
      userId,
      storagePath: creation.storagePath,
      mediaUrl: creation.mediaUrl,
      ttl: "pipeline",
    });
    if (!signedUrl) {
      return { ok: false, error: "A mentioned asset could not be found." };
    }
    const metaName =
      typeof creation.metadata?.characterName === "string"
        ? creation.metadata.characterName.trim()
        : "";
    const kind: MentionAssetKind =
      creation.metadata?.creationKind === "character"
        ? "character"
        : creation.tool === "storyboard"
          ? "storyboard"
          : "image";
    const fallbackName =
      kind === "character" ? "Character" : kind === "storyboard" ? "Storyboard" : "Image";
    items.push({
      id,
      url: signedUrl,
      ref: { name: metaName || creation.title || fallbackName, kind },
    });
  }
  return { ok: true, items };
}
