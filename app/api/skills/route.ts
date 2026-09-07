import { NextResponse } from "next/server";
import { getCurrentProfile, requireCurrentProfile } from "@/lib/profiles-db";
import {
  createCustomSkill,
  listCatalogSkills,
  parseCustomSkillBody,
} from "@/lib/skill-configs-db";

export const dynamic = "force-dynamic";

/** Merged catalog for this visitor: shared skills plus their own. */
export async function GET() {
  try {
    const profile = await getCurrentProfile();
    const skills = await listCatalogSkills({ viewerProfileId: profile?.id ?? null });
    return NextResponse.json({ skills });
  } catch (e) {
    console.error("[api/skills] failed:", e);
    return NextResponse.json({ error: "Failed to load skills." }, { status: 500 });
  }
}

/** Create a skill that only this account can see. */
export async function POST(req: Request) {
  try {
    const profile = await requireCurrentProfile();
    const parsed = parseCustomSkillBody(await req.json().catch(() => null));
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const skill = await createCustomSkill(parsed.input, {
      updatedByProfileId: profile.id,
      ownerProfileId: profile.id,
    });
    return NextResponse.json({ skill }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create skill.";
    if (/not authenticated/i.test(message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    if (/up to \d+ of your own skills/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[api/skills] create failed:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
