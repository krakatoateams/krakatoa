import type { CreationHistoryItem } from "@/lib/creations";

export type MentionAssetKind = "character" | "storyboard" | "image";

export type MentionAsset = {
  id: string;
  name: string;
  url: string;
  kind: MentionAssetKind;
};

export type MentionRef = { name: string; kind: MentionAssetKind };

export function mentionAssetFromCreation(it: CreationHistoryItem): MentionAsset | null {
  if (!it.mediaUrl) return null;
  if (it.metadata?.creationKind === "character") {
    const name =
      (typeof it.metadata?.characterName === "string" && it.metadata.characterName.trim()) ||
      it.title ||
      "Character";
    return { id: it.id, name, url: it.mediaUrl, kind: "character" };
  }
  if (it.tool === "storyboard") {
    return { id: it.id, name: it.title || "Storyboard", url: it.mediaUrl, kind: "storyboard" };
  }
  if (it.tool === "product_photo") {
    return { id: it.id, name: it.title || "Image", url: it.mediaUrl, kind: "image" };
  }
  return null;
}

/** Parse history rows into @-mentionable assets (characters, storyboards, photo images). */
export function parseMentionAssetsFromHistory(items: CreationHistoryItem[]): MentionAsset[] {
  const out: MentionAsset[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const asset = mentionAssetFromCreation(it);
    if (asset && !seen.has(asset.id)) {
      seen.add(asset.id);
      out.push(asset);
    }
  }
  return out;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Find the active "@query" the caret is sitting in. Returns null when not mentioning. */
export function activeMentionQuery(value: string, caret: number): string | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
  return match ? match[1] : null;
}

export function buildMentionGuidanceSuffix(mentionRefs: MentionRef[]): string {
  if (!mentionRefs.length) return "";
  const list = mentionRefs.map((r) => `@${r.name} (${r.kind})`).join(", ");
  const many = mentionRefs.length > 1;
  return ` The description references ${list}; matching reference image${many ? "s have" : " has"} been provided. Use ${many ? "them" : "it"} as the visual reference, preserving appearance and identity.`;
}

/** Map @Name tokens to [ImageN] for Seedance-style indexed references. */
export function mapMentionsToImageTokens(
  prompt: string,
  mentions: { name: string }[],
  imageIndexOffset: number
): string {
  let out = prompt;
  mentions.forEach((m, i) => {
    const token = `[Image${imageIndexOffset + i + 1}]`;
    out = out.replace(
      new RegExp(`@${escapeRegExp(m.name)}(?=\\s|$|[.,!?;:])`, "g"),
      token
    );
  });
  return out;
}

export type ResolvedMentionCreation = {
  id: string;
  url: string;
  ref: MentionRef;
};
