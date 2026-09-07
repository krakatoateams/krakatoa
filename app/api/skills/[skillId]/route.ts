import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import {
  deleteOwnedSkill,
  getOwnedSkillOverride,
  loadOwnedCatalogSkill,
  parseSkillInputs,
  updateOwnedSkill,
  type SkillConfigPatch,
} from "@/lib/skill-configs-db";
import { SKILL_CATEGORIES, isSkillSlug, type SkillCategoryId } from "@/lib/skills";

export const dynamic = "force-dynamic";

function isCategoryId(value: string): value is SkillCategoryId {
  return SKILL_CATEGORIES.some((c) => c.id === value);
}

function authError(e: unknown): NextResponse | null {
  const message = e instanceof Error ? e.message : String(e);
  if (/not authenticated/i.test(message)) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  return null;
}

export async function GET(
  _req: Request,
  { params }: { params: { skillId: string } }
) {
  try {
    const profile = await requireCurrentProfile();
    if (!isSkillSlug(params.skillId)) {
      return NextResponse.json({ error: "Unknown skill." }, { status: 404 });
    }
    const skill = await loadOwnedCatalogSkill(profile.id, params.skillId);
    if (!skill) return NextResponse.json({ error: "Unknown skill." }, { status: 404 });
    return NextResponse.json({ skill });
  } catch (e) {
    return authError(e) ?? NextResponse.json({ error: "Failed to load skill." }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { skillId: string } }
) {
  try {
    const profile = await requireCurrentProfile();
    if (!isSkillSlug(params.skillId)) {
      return NextResponse.json({ error: "Unknown skill." }, { status: 404 });
    }
    const existing = await getOwnedSkillOverride(profile.id, params.skillId);
    if (!existing?.mediaType) {
      return NextResponse.json({ error: "Unknown skill." }, { status: 404 });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const patch: SkillConfigPatch = {};

    if ("title" in body) {
      if (typeof body.title !== "string" || !body.title.trim()) {
        return NextResponse.json({ error: "Title is required." }, { status: 400 });
      }
      if (body.title.trim().length > 80) {
        return NextResponse.json({ error: "Title is too long." }, { status: 400 });
      }
      patch.title = body.title.trim();
    }

    if ("description" in body) {
      if (typeof body.description !== "string") {
        return NextResponse.json({ error: "Description must be a string." }, { status: 400 });
      }
      if (body.description.length > 280) {
        return NextResponse.json({ error: "Description is too long." }, { status: 400 });
      }
      patch.description = body.description.trim();
    }

    if ("promptPlaceholder" in body) {
      if (typeof body.promptPlaceholder !== "string") {
        return NextResponse.json({ error: "Placeholder must be a string." }, { status: 400 });
      }
      if (body.promptPlaceholder.length > 240) {
        return NextResponse.json({ error: "Placeholder is too long." }, { status: 400 });
      }
      patch.promptPlaceholder = body.promptPlaceholder;
    }

    if ("recipe" in body) {
      if (typeof body.recipe !== "string") {
        return NextResponse.json({ error: "Recipe must be a string." }, { status: 400 });
      }
      if (body.recipe.length > 8000) {
        return NextResponse.json({ error: "Recipe is too long." }, { status: 400 });
      }
      patch.recipe = body.recipe;
    }

    if ("category" in body) {
      if (typeof body.category !== "string" || !isCategoryId(body.category)) {
        return NextResponse.json({ error: "Invalid category." }, { status: 400 });
      }
      patch.category = body.category;
    }

    if ("badge" in body) {
      if (body.badge !== "new" && body.badge !== null) {
        return NextResponse.json({ error: "Badge must be “new” or null." }, { status: 400 });
      }
      patch.badge = body.badge;
    }

    if ("promptRequired" in body) {
      if (typeof body.promptRequired !== "boolean") {
        return NextResponse.json({ error: "promptRequired must be a boolean." }, { status: 400 });
      }
      patch.promptRequired = body.promptRequired;
    }

    const nextMediaType =
      body.mediaType === "image" || body.mediaType === "video"
        ? body.mediaType
        : existing.mediaType;

    if ("mediaType" in body) {
      if (body.mediaType !== "image" && body.mediaType !== "video") {
        return NextResponse.json({ error: "Choose Image or Video." }, { status: 400 });
      }
      patch.mediaType = body.mediaType;
    }

    if ("inputs" in body) {
      const parsed = parseSkillInputs(body.inputs, nextMediaType);
      if (parsed === null) {
        return NextResponse.json({ error: "Invalid input slots." }, { status: 400 });
      }
      patch.inputs = parsed;
      if (!("mediaType" in patch)) patch.mediaType = nextMediaType;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const skill = await updateOwnedSkill(profile.id, params.skillId, patch);
    return NextResponse.json({ skill });
  } catch (e) {
    const unauthorized = authError(e);
    if (unauthorized) return unauthorized;
    const message = e instanceof Error ? e.message : "Failed to update skill.";
    if (message === "Unknown skill.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { skillId: string } }
) {
  try {
    const profile = await requireCurrentProfile();
    if (!isSkillSlug(params.skillId)) {
      return NextResponse.json({ error: "Unknown skill." }, { status: 404 });
    }
    await deleteOwnedSkill(profile.id, params.skillId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const unauthorized = authError(e);
    if (unauthorized) return unauthorized;
    const message = e instanceof Error ? e.message : "Failed to delete skill.";
    if (message === "Unknown skill.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
