import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { supabaseServer } from "@/lib/supabase-server";
import {
  MEDIA_CACHE_CONTROL,
  STORAGE_BUCKET,
  platformSkillThumbPath,
} from "@/lib/storage-buckets";
import { createSignedStorageUrl } from "@/lib/storage-signed-url";
import { getOwnedSkillOverride, updateOwnedSkill } from "@/lib/skill-configs-db";
import { isSkillSlug } from "@/lib/skills";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, "jpg" | "jpeg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(
  req: Request,
  { params }: { params: { skillId: string } }
) {
  try {
    const profile = await requireCurrentProfile();
    if (!isSkillSlug(params.skillId)) {
      return NextResponse.json({ error: "Unknown skill." }, { status: 404 });
    }
    const existing = await getOwnedSkillOverride(profile.id, params.skillId);
    if (!existing) {
      return NextResponse.json({ error: "Unknown skill." }, { status: 404 });
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No image file." }, { status: 400 });
    }
    const ext = TYPES[file.type];
    if (!ext) {
      return NextResponse.json({ error: "Use JPEG, PNG, or WebP." }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image must be under 2 MB." }, { status: 413 });
    }

    const storagePath = platformSkillThumbPath(params.skillId, ext);
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error } = await supabaseServer.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, {
      contentType: file.type,
      cacheControl: MEDIA_CACHE_CONTROL,
      upsert: false,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const skill = await updateOwnedSkill(profile.id, params.skillId, { thumbPath: storagePath });
    const signed = await createSignedStorageUrl(storagePath, "ui");
    return NextResponse.json({ skill, thumb: signed.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to upload thumbnail.";
    if (/not authenticated/i.test(message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    if (message === "Unknown skill.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
