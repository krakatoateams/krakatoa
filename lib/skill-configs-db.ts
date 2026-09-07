import { supabaseServer } from "@/lib/supabase-server";
import { createSignedStorageUrl } from "@/lib/storage-signed-url";
import { STORAGE_BUCKET } from "@/lib/storage-buckets";
import {
  SKILL_CATEGORIES,
  SKILL_INPUT_DEFAULTS,
  SKILL_INPUT_KEYS,
  SKILLS,
  defaultSkillInputs,
  defaultSkillRecipe,
  getSkill,
  isSkillId,
  isSkillSlug,
  slugifySkillId,
  type Skill,
  type SkillCategoryId,
  type SkillIconName,
  type SkillId,
  type SkillInputKey,
  type SkillInputSlot,
  type SkillMediaType,
} from "@/lib/skills";

const TABLE = "skill_configs";
const CACHE_TTL_MS = 60_000;
export const MAX_USER_SKILLS = 24;
const SELECT_COLS =
  "skill_id, title, description, prompt_placeholder, recipe, thumb_path, category, badge, prompt_required, origin, media_type, inputs, icon, hidden, owner_profile_id";

const SKILL_ICONS: SkillIconName[] = [
  "scroll",
  "copy",
  "video",
  "book",
  "spark",
  "wand",
  "smile",
  "layout",
  "pen",
  "bag",
  "user",
  "shirt",
  "music",
  "tag",
  "grid",
  "align",
  "layers",
  "image",
  "sparkles",
  "clapper",
  "box",
  "flame",
  "camera",
  "utensils",
];

export type SkillConfigOrigin = "overlay" | "custom";

export type SkillConfigOverride = {
  skillId: SkillId;
  title: string | null;
  description: string | null;
  promptPlaceholder: string | null;
  recipe: string | null;
  thumbPath: string | null;
  category: SkillCategoryId | null;
  badge: "new" | null;
  promptRequired: boolean | null;
  origin: SkillConfigOrigin;
  mediaType: SkillMediaType | null;
  inputs: SkillInputSlot[] | null;
  icon: SkillIconName | null;
  hidden: boolean;
  ownerProfileId: string | null;
};

export type CatalogSkill = Skill & {
  recipe: string;
  origin: "catalog" | "overlay" | "custom";
  hidden?: boolean;
  owned?: boolean;
};

export type SkillConfigPatch = {
  title?: string | null;
  description?: string | null;
  promptPlaceholder?: string | null;
  recipe?: string | null;
  thumbPath?: string | null;
  category?: SkillCategoryId | null;
  badge?: "new" | null;
  promptRequired?: boolean | null;
  mediaType?: SkillMediaType | null;
  inputs?: SkillInputSlot[] | null;
  icon?: SkillIconName | null;
  hidden?: boolean;
  revert?: boolean;
};

export type CreateCustomSkillInput = {
  title: string;
  description: string;
  promptPlaceholder: string;
  recipe: string;
  category: SkillCategoryId;
  badge: "new" | null;
  promptRequired: boolean;
  mediaType: SkillMediaType;
  inputs: SkillInputSlot[];
  icon?: SkillIconName;
};

type SkillConfigRow = {
  skill_id: string;
  title: string | null;
  description: string | null;
  prompt_placeholder: string | null;
  recipe: string | null;
  thumb_path: string | null;
  category: string | null;
  badge: string | null;
  prompt_required: boolean | null;
  origin?: string | null;
  media_type?: string | null;
  inputs?: unknown;
  icon?: string | null;
  hidden?: boolean | null;
  owner_profile_id?: string | null;
};

let cache: { byId: Map<SkillId, SkillConfigOverride>; expiresAt: number } = {
  byId: new Map(),
  expiresAt: 0,
};

function emptyCache(): Map<SkillId, SkillConfigOverride> {
  return new Map();
}

export function bustSkillConfigCache(): void {
  cache = { byId: emptyCache(), expiresAt: 0 };
}

function isCategoryId(value: string | null): value is SkillCategoryId {
  return SKILL_CATEGORIES.some((c) => c.id === value);
}

function isIconName(value: string | null | undefined): value is SkillIconName {
  return !!value && (SKILL_ICONS as string[]).includes(value);
}

export function parseSkillInputs(raw: unknown, mediaType: SkillMediaType): SkillInputSlot[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SkillInputSlot[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    const key = typeof rec.key === "string" ? rec.key : "";
    if (!(SKILL_INPUT_KEYS as readonly string[]).includes(key) || seen.has(key)) return null;
    const meta = SKILL_INPUT_DEFAULTS[key as SkillInputKey];
    if (meta.mediaType !== mediaType) return null;
    seen.add(key);
    const label =
      typeof rec.label === "string" && rec.label.trim()
        ? rec.label.trim().slice(0, 24)
        : meta.label;
    out.push({ key, label, required: rec.required === true });
  }
  return out;
}

export function parseCustomSkillBody(
  body: unknown
): { error: string } | { input: CreateCustomSkillInput } {
  if (!body || typeof body !== "object") return { error: "Invalid JSON body." };
  const rec = body as Record<string, unknown>;

  const title = typeof rec.title === "string" ? rec.title.trim() : "";
  if (!title) return { error: "Title is required." };
  if (title.length > 80) return { error: "Title is too long." };

  const description = typeof rec.description === "string" ? rec.description.trim() : "";
  if (description.length > 280) return { error: "Description is too long." };

  const promptPlaceholder = typeof rec.promptPlaceholder === "string" ? rec.promptPlaceholder : "";
  if (promptPlaceholder.length > 240) return { error: "Placeholder is too long." };

  const recipe = typeof rec.recipe === "string" ? rec.recipe : "{prompt}";
  if (recipe.length > 8000) return { error: "Recipe is too long." };
  if (!recipe.trim()) return { error: "Recipe is required." };

  const category = typeof rec.category === "string" ? rec.category : "storytelling";
  if (!isCategoryId(category)) return { error: "Invalid category." };

  if (rec.badge !== undefined && rec.badge !== "new" && rec.badge !== null) {
    return { error: "Badge must be “new” or null." };
  }

  const mediaType = rec.mediaType;
  if (mediaType !== "image" && mediaType !== "video") {
    return { error: "Choose Image or Video." };
  }

  const parsedInputs = parseSkillInputs(rec.inputs, mediaType);
  if (rec.inputs !== undefined && parsedInputs === null) {
    return { error: "Invalid input slots." };
  }

  return {
    input: {
      title,
      description,
      promptPlaceholder,
      recipe,
      category,
      badge: rec.badge === "new" ? "new" : null,
      promptRequired: rec.promptRequired !== false,
      mediaType,
      inputs: parsedInputs ?? defaultSkillInputs(mediaType),
    },
  };
}

function mapRow(row: SkillConfigRow): SkillConfigOverride | null {
  const origin: SkillConfigOrigin = row.origin === "custom" ? "custom" : "overlay";
  if (origin === "custom") {
    if (!isSkillSlug(row.skill_id) || isSkillId(row.skill_id)) return null;
  } else if (!isSkillId(row.skill_id)) {
    return null;
  }

  const mediaType =
    row.media_type === "image" || row.media_type === "video"
      ? row.media_type
      : isSkillId(row.skill_id)
        ? (getSkill(row.skill_id)?.mediaType ?? null)
        : null;
  const inputs =
    mediaType && row.inputs != null ? parseSkillInputs(row.inputs, mediaType) : null;

  return {
    skillId: row.skill_id,
    title: row.title,
    description: row.description,
    promptPlaceholder: row.prompt_placeholder,
    recipe: row.recipe,
    thumbPath: row.thumb_path,
    category: isCategoryId(row.category) ? row.category : null,
    badge: row.badge === "new" ? "new" : null,
    promptRequired: typeof row.prompt_required === "boolean" ? row.prompt_required : null,
    origin,
    mediaType,
    inputs,
    icon: isIconName(row.icon) ? row.icon : null,
    hidden: row.hidden === true,
    ownerProfileId: row.owner_profile_id || null,
  };
}

export async function getSkillOverrides(): Promise<Map<SkillId, SkillConfigOverride>> {
  const now = Date.now();
  if (now < cache.expiresAt) return cache.byId;

  try {
    const { data, error } = await supabaseServer
      .from(TABLE)
      .select(SELECT_COLS)
      .is("owner_profile_id", null);

    if (error) {
      console.warn("[skill-configs] DB read failed, using catalog defaults:", error.message);
      return emptyCache();
    }

    const byId = emptyCache();
    for (const raw of data ?? []) {
      const mapped = mapRow(raw as SkillConfigRow);
      if (mapped) byId.set(mapped.skillId, mapped);
    }
    cache = { byId, expiresAt: now + CACHE_TTL_MS };
    return byId;
  } catch (e) {
    console.warn("[skill-configs] read threw, using catalog defaults:", e);
    return emptyCache();
  }
}

export async function getSkillOverride(skillId: SkillId): Promise<SkillConfigOverride | null> {
  const all = await getSkillOverrides();
  return all.get(skillId) ?? null;
}

async function getOwnedOverrides(ownerProfileId: string): Promise<SkillConfigOverride[]> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select(SELECT_COLS)
    .eq("owner_profile_id", ownerProfileId)
    .eq("origin", "custom");
  if (error) {
    console.warn("[skill-configs] owned read failed:", error.message);
    return [];
  }
  return (data ?? [])
    .map((raw) => mapRow(raw as SkillConfigRow))
    .filter((row): row is SkillConfigOverride => Boolean(row));
}

export async function getOwnedSkillOverride(
  ownerProfileId: string,
  skillId: SkillId
): Promise<SkillConfigOverride | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select(SELECT_COLS)
    .eq("skill_id", skillId)
    .eq("owner_profile_id", ownerProfileId)
    .eq("origin", "custom")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as SkillConfigRow) : null;
}

async function signThumb(path: string | null | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    const signed = await createSignedStorageUrl(path, "ui");
    return signed.url;
  } catch (e) {
    console.warn("[skill-configs] failed to sign thumb:", e);
    return undefined;
  }
}

export function mergeSkill(
  base: Skill,
  override: SkillConfigOverride | null,
  thumbUrl?: string
): CatalogSkill {
  const recipe = override?.recipe?.trim() || defaultSkillRecipe(base.id);
  if (!override) {
    return { ...base, recipe, thumb: thumbUrl || base.thumb, origin: "catalog" };
  }
  return {
    ...base,
    title: override.title?.trim() || base.title,
    description: override.description?.trim() || base.description,
    promptPlaceholder: override.promptPlaceholder?.trim() || base.promptPlaceholder,
    promptRequired:
      typeof override.promptRequired === "boolean" ? override.promptRequired : base.promptRequired,
    category: override.category ?? base.category,
    badge: override.badge === "new" ? "new" : base.badge,
    inputs: override.inputs ?? base.inputs,
    recipe,
    thumb: thumbUrl || base.thumb,
    origin: override.origin === "custom" ? "custom" : "overlay",
    hidden: override.hidden,
  };
}

function customSkillFromOverride(
  override: SkillConfigOverride,
  thumbUrl?: string
): CatalogSkill | null {
  if (override.origin !== "custom") return null;
  const title = override.title?.trim();
  const mediaType = override.mediaType;
  if (!title || (mediaType !== "image" && mediaType !== "video")) return null;
  return {
    id: override.skillId,
    title,
    description: override.description?.trim() || "",
    category: override.category ?? "storytelling",
    mediaType,
    icon: override.icon ?? (mediaType === "video" ? "video" : "spark"),
    thumb: thumbUrl || "",
    promptPlaceholder: override.promptPlaceholder ?? "",
    promptRequired: typeof override.promptRequired === "boolean" ? override.promptRequired : true,
    inputs: override.inputs ?? defaultSkillInputs(mediaType),
    badge: override.badge ?? undefined,
    recipe: override.recipe?.trim() || "{prompt}",
    origin: "custom",
    hidden: override.hidden,
    owned: Boolean(override.ownerProfileId),
  };
}

export async function listCatalogSkills(opts?: {
  includeHidden?: boolean;
  viewerProfileId?: string | null;
}): Promise<CatalogSkill[]> {
  const includeHidden = opts?.includeHidden === true;
  const viewerProfileId = opts?.viewerProfileId ?? null;
  const overrides = await getSkillOverrides();
  const skills: CatalogSkill[] = [];
  for (const base of SKILLS) {
    const override = overrides.get(base.id) ?? null;
    if (override?.hidden && !includeHidden) continue;
    const thumbUrl = await signThumb(override?.thumbPath);
    skills.push(mergeSkill(base, override, thumbUrl));
  }
  const customs = Array.from(overrides.values())
    .filter((row) => row.origin === "custom" && !row.ownerProfileId && (includeHidden || !row.hidden))
    .sort((a, b) => (a.title || a.skillId).localeCompare(b.title || b.skillId));
  for (const override of customs) {
    const thumbUrl = await signThumb(override.thumbPath);
    const skill = customSkillFromOverride(override, thumbUrl);
    if (skill) skills.push({ ...skill, owned: false });
  }
  if (viewerProfileId) {
    const owned = await getOwnedOverrides(viewerProfileId);
    const visible = owned
      .filter((row) => includeHidden || !row.hidden)
      .sort((a, b) => (a.title || a.skillId).localeCompare(b.title || b.skillId));
    for (const override of visible) {
      const thumbUrl = await signThumb(override.thumbPath);
      const skill = customSkillFromOverride(override, thumbUrl);
      if (skill) skills.push({ ...skill, owned: true });
    }
  }
  return skills;
}

export async function resolveLiveSkill(
  id: string,
  viewerProfileId?: string | null
): Promise<CatalogSkill | null> {
  if (!isSkillSlug(id)) return null;
  if (viewerProfileId) {
    const owned = await getOwnedSkillOverride(viewerProfileId, id);
    if (owned?.hidden) return null;
    if (owned) {
      const skill = customSkillFromOverride(owned);
      return skill ? { ...skill, owned: true } : null;
    }
  }
  const override = await getSkillOverride(id);
  if (override?.ownerProfileId) return null;
  if (override?.hidden) return null;
  const base = getSkill(id);
  if (base) return mergeSkill(base, override);
  if (override) {
    const skill = customSkillFromOverride(override);
    return skill ? { ...skill, owned: false } : null;
  }
  return null;
}

function patchToRow(skillId: string, patch: SkillConfigPatch, updatedByProfileId?: string | null) {
  const row: Record<string, unknown> = { skill_id: skillId };
  if ("title" in patch) row.title = patch.title;
  if ("description" in patch) row.description = patch.description;
  if ("promptPlaceholder" in patch) row.prompt_placeholder = patch.promptPlaceholder;
  if ("recipe" in patch) row.recipe = patch.recipe;
  if ("thumbPath" in patch) row.thumb_path = patch.thumbPath;
  if ("category" in patch) row.category = patch.category;
  if ("badge" in patch) row.badge = patch.badge;
  if ("promptRequired" in patch) row.prompt_required = patch.promptRequired;
  if ("mediaType" in patch) row.media_type = patch.mediaType;
  if ("inputs" in patch) row.inputs = patch.inputs;
  if ("icon" in patch) row.icon = patch.icon;
  if ("hidden" in patch) row.hidden = patch.hidden;
  if (updatedByProfileId !== undefined) row.updated_by_profile_id = updatedByProfileId;
  return row;
}

export async function upsertSkillConfig(
  skillId: SkillId,
  patch: SkillConfigPatch,
  updatedByProfileId?: string | null
): Promise<SkillConfigOverride | null> {
  const { data: existingRow } = await supabaseServer
    .from(TABLE)
    .select("owner_profile_id")
    .eq("skill_id", skillId)
    .maybeSingle();
  if (existingRow?.owner_profile_id) {
    throw new Error("Unknown skill.");
  }

  if (patch.revert) {
    const existing = await getSkillOverride(skillId);
    if (existing?.hidden) {
      throw new Error("Deleted skills cannot be restored.");
    }
    const { error } = await supabaseServer.from(TABLE).delete().eq("skill_id", skillId);
    if (error) throw new Error(error.message);
    bustSkillConfigCache();
    return null;
  }

  const row = patchToRow(skillId, patch, updatedByProfileId);
  const { data, error } = await supabaseServer
    .from(TABLE)
    .upsert(row, { onConflict: "skill_id" })
    .select(SELECT_COLS)
    .maybeSingle();

  if (error) throw new Error(error.message);
  bustSkillConfigCache();
  return data ? mapRow(data as SkillConfigRow) : null;
}

async function removeSkillThumb(path: string | null | undefined): Promise<void> {
  if (!path) return;
  const { error } = await supabaseServer.storage.from(STORAGE_BUCKET).remove([path]);
  if (error) console.warn("[skill-configs] failed to remove thumb:", error.message);
}

/** Permanently remove a skill from the live catalog. Custom rows are deleted;
 *  builtin catalog ids are tombstoned (`hidden`) so they cannot come back from code.
 *  There is no restore. */
export async function deleteCatalogSkill(
  skillId: SkillId,
  updatedByProfileId?: string | null
): Promise<{ hidden: boolean }> {
  const override = await getSkillOverride(skillId);
  const builtin = isSkillId(skillId);
  if (!builtin && override?.origin !== "custom") {
    throw new Error("Unknown skill.");
  }

  if (!builtin) {
    await removeSkillThumb(override?.thumbPath);
    const { error } = await supabaseServer.from(TABLE).delete().eq("skill_id", skillId);
    if (error) throw new Error(error.message);
    bustSkillConfigCache();
    return { hidden: false };
  }

  await upsertSkillConfig(skillId, { hidden: true }, updatedByProfileId);
  return { hidden: true };
}

async function uniqueCustomSkillId(title: string): Promise<string> {
  const base = slugifySkillId(title);
  let id = base;
  let n = 2;
  while (await skillIdTaken(id)) {
    const suffix = `-${n++}`;
    id = `${base.slice(0, Math.max(2, 48 - suffix.length))}${suffix}`;
    if (n > 50) {
      id = `skill-${Date.now().toString(36)}`;
      break;
    }
  }
  return id;
}

async function skillIdTaken(id: string): Promise<boolean> {
  if (isSkillId(id) || !isSkillSlug(id)) return true;
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("skill_id")
    .eq("skill_id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function loadOwnedCatalogSkill(
  ownerProfileId: string,
  skillId: SkillId
): Promise<CatalogSkill | null> {
  const override = await getOwnedSkillOverride(ownerProfileId, skillId);
  if (!override) return null;
  const thumbUrl = await signThumb(override.thumbPath);
  const skill = customSkillFromOverride(override, thumbUrl);
  return skill ? { ...skill, owned: true } : null;
}

export async function createCustomSkill(
  input: CreateCustomSkillInput,
  opts?: { updatedByProfileId?: string | null; ownerProfileId?: string | null }
): Promise<CatalogSkill> {
  const ownerProfileId = opts?.ownerProfileId ?? null;
  const updatedByProfileId = opts?.updatedByProfileId;

  if (ownerProfileId) {
    const { count, error: countError } = await supabaseServer
      .from(TABLE)
      .select("skill_id", { count: "exact", head: true })
      .eq("owner_profile_id", ownerProfileId)
      .eq("origin", "custom");
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= MAX_USER_SKILLS) {
      throw new Error(`You can save up to ${MAX_USER_SKILLS} of your own skills.`);
    }
  }

  const skillId = await uniqueCustomSkillId(input.title);
  const row: Record<string, unknown> = {
    skill_id: skillId,
    origin: "custom",
    title: input.title,
    description: input.description,
    prompt_placeholder: input.promptPlaceholder,
    recipe: input.recipe,
    category: input.category,
    badge: input.badge,
    prompt_required: input.promptRequired,
    media_type: input.mediaType,
    inputs: input.inputs,
    icon: input.icon ?? (input.mediaType === "video" ? "video" : "spark"),
    owner_profile_id: ownerProfileId,
  };
  if (updatedByProfileId !== undefined) row.updated_by_profile_id = updatedByProfileId;

  const { data, error } = await supabaseServer.from(TABLE).insert(row).select(SELECT_COLS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!ownerProfileId) bustSkillConfigCache();
  const mapped = data ? mapRow(data as SkillConfigRow) : null;
  const skill = mapped ? customSkillFromOverride(mapped) : null;
  if (!skill) throw new Error("Failed to create skill.");
  return { ...skill, owned: Boolean(ownerProfileId) };
}

export async function updateOwnedSkill(
  ownerProfileId: string,
  skillId: SkillId,
  patch: SkillConfigPatch
): Promise<CatalogSkill> {
  const existing = await getOwnedSkillOverride(ownerProfileId, skillId);
  if (!existing) throw new Error("Unknown skill.");
  const row = patchToRow(skillId, patch, ownerProfileId);
  delete row.skill_id;
  const { data, error } = await supabaseServer
    .from(TABLE)
    .update(row)
    .eq("skill_id", skillId)
    .eq("owner_profile_id", ownerProfileId)
    .select(SELECT_COLS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const mapped = data ? mapRow(data as SkillConfigRow) : existing;
  const thumbUrl = await signThumb(mapped?.thumbPath);
  const skill = mapped ? customSkillFromOverride(mapped, thumbUrl) : null;
  if (!skill) throw new Error("Failed to update skill.");
  return { ...skill, owned: true };
}

export async function deleteOwnedSkill(ownerProfileId: string, skillId: SkillId): Promise<void> {
  const existing = await getOwnedSkillOverride(ownerProfileId, skillId);
  if (!existing) throw new Error("Unknown skill.");
  await removeSkillThumb(existing.thumbPath);
  const { error } = await supabaseServer
    .from(TABLE)
    .delete()
    .eq("skill_id", skillId)
    .eq("owner_profile_id", ownerProfileId);
  if (error) throw new Error(error.message);
}
