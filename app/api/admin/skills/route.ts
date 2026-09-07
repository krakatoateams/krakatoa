import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import {
  createCustomSkill,
  listCatalogSkills,
  parseSkillInputs,
  type CreateCustomSkillInput,
} from "@/lib/skill-configs-db";
import {
  SKILL_CATEGORIES,
  defaultSkillInputs,
  type SkillCategoryId,
  type SkillMediaType,
} from "@/lib/skills";

export const dynamic = "force-dynamic";

function isCategoryId(value: string): value is SkillCategoryId {
  return SKILL_CATEGORIES.some((c) => c.id === value);
}

export async function GET() {
  return withAdmin(async () => {
    const skills = await listCatalogSkills();
    return NextResponse.json({ skills });
  });
}

export async function POST(req: Request) {
  return withAdmin(async (ctx) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }
    if (title.length > 80) {
      return NextResponse.json({ error: "Title is too long." }, { status: 400 });
    }

    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (description.length > 280) {
      return NextResponse.json({ error: "Description is too long." }, { status: 400 });
    }

    const promptPlaceholder =
      typeof body.promptPlaceholder === "string" ? body.promptPlaceholder : "";
    if (promptPlaceholder.length > 240) {
      return NextResponse.json({ error: "Placeholder is too long." }, { status: 400 });
    }

    const recipe = typeof body.recipe === "string" ? body.recipe : "{prompt}";
    if (recipe.length > 8000) {
      return NextResponse.json({ error: "Recipe is too long." }, { status: 400 });
    }
    if (!recipe.trim()) {
      return NextResponse.json({ error: "Recipe is required." }, { status: 400 });
    }

    const category = typeof body.category === "string" ? body.category : "storytelling";
    if (!isCategoryId(category)) {
      return NextResponse.json({ error: "Invalid category." }, { status: 400 });
    }

    if (body.badge !== undefined && body.badge !== "new" && body.badge !== null) {
      return NextResponse.json({ error: "Badge must be “new” or null." }, { status: 400 });
    }

    const mediaType = body.mediaType;
    if (mediaType !== "image" && mediaType !== "video") {
      return NextResponse.json({ error: "Choose Image or Video." }, { status: 400 });
    }

    const promptRequired = body.promptRequired !== false;

    const parsedInputs = parseSkillInputs(body.inputs, mediaType as SkillMediaType);
    if (body.inputs !== undefined && parsedInputs === null) {
      return NextResponse.json({ error: "Invalid input slots." }, { status: 400 });
    }

    const input: CreateCustomSkillInput = {
      title,
      description,
      promptPlaceholder,
      recipe,
      category,
      badge: body.badge === "new" ? "new" : null,
      promptRequired,
      mediaType,
      inputs: parsedInputs ?? defaultSkillInputs(mediaType),
    };

    try {
      const skill = await createCustomSkill(input, { updatedByProfileId: ctx.profile.id });
      return NextResponse.json({ skill }, { status: 201 });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to create skill.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
