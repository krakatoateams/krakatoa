import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import {
  deleteCatalogSkill,
  getSkillOverride,
  listCatalogSkills,
  parseSkillInputs,
  upsertSkillConfig,
  parseSkillModelId,
  type SkillConfigPatch,
} from "@/lib/skill-configs-db";
import {
  SKILL_CATEGORIES,
  isSkillId,
  isSkillSlug,
  type SkillCategoryId,
} from "@/lib/skills";

export const dynamic = "force-dynamic";

function isCategoryId(value: string): value is SkillCategoryId {
  return SKILL_CATEGORIES.some((c) => c.id === value);
}

export async function GET(
  _req: Request,
  { params }: { params: { skillId: string } }
) {
  return withAdmin(async () => {
    if (!isSkillSlug(params.skillId)) {
      return NextResponse.json({ error: "Unknown skill." }, { status: 404 });
    }
    const skills = await listCatalogSkills();
    const skill = skills.find((s) => s.id === params.skillId);
    if (!skill) {
      return NextResponse.json({ error: "Unknown skill." }, { status: 404 });
    }
    const override = await getSkillOverride(params.skillId);
    return NextResponse.json({ skill, override });
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: { skillId: string } }
) {
  return withAdmin(async (ctx) => {
    if (!isSkillSlug(params.skillId)) {
      return NextResponse.json({ error: "Unknown skill." }, { status: 404 });
    }

    const skillsBefore = await listCatalogSkills();
    const existing = skillsBefore.find((s) => s.id === params.skillId);
    if (!existing) {
      return NextResponse.json({ error: "Unknown skill." }, { status: 404 });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (body.revert === true) {
      await upsertSkillConfig(params.skillId, { revert: true }, ctx.profile.id);
      const skills = await listCatalogSkills();
      const skill = skills.find((s) => s.id === params.skillId) ?? null;
      return NextResponse.json({ skill, deleted: !skill });
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
      if (isSkillId(params.skillId)) {
        return NextResponse.json(
          { error: "Catalog skills keep their original media type." },
          { status: 400 }
        );
      }
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
      if (existing.origin === "custom" && !("mediaType" in patch)) {
        patch.mediaType = nextMediaType;
      }
    }

    if ("modelId" in body) {
      const parsed = parseSkillModelId(body.modelId, nextMediaType);
      if ("error" in parsed) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      patch.modelId = parsed.modelId;
    } else if ("mediaType" in patch && existing.modelId) {
      const parsed = parseSkillModelId(existing.modelId, nextMediaType);
      if ("error" in parsed) patch.modelId = null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    await upsertSkillConfig(params.skillId, patch, ctx.profile.id);
    const skills = await listCatalogSkills();
    const skill = skills.find((s) => s.id === params.skillId);
    return NextResponse.json({ skill });
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { skillId: string } }
) {
  return withAdmin(async (ctx) => {
    if (!isSkillSlug(params.skillId)) {
      return NextResponse.json({ error: "Unknown skill." }, { status: 404 });
    }
    const skills = await listCatalogSkills();
    const existing = skills.find((s) => s.id === params.skillId);
    if (!existing) {
      return NextResponse.json({ error: "Unknown skill." }, { status: 404 });
    }
    try {
      const result = await deleteCatalogSkill(params.skillId, ctx.profile.id);
      return NextResponse.json({ ok: true, ...result });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to delete skill.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  });
}
