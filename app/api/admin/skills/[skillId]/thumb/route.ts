import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { supabaseServer } from "@/lib/supabase-server";
import {
  MEDIA_CACHE_CONTROL,
  STORAGE_BUCKET,
  platformSkillThumbPath,
} from "@/lib/storage-buckets";
import { createSignedStorageUrl } from "@/lib/storage-signed-url";
import { listCatalogSkills, upsertSkillConfig } from "@/lib/skill-configs-db";
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
  return withAdmin(async (ctx) => {
    if (!isSkillSlug(params.skillId)) {
      return NextResponse.json({ error: "Unknown skill." }, { status: 404 });
    }
    const existing = (await listCatalogSkills()).find(
      (s) => s.id === params.skillId
    );
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

    await upsertSkillConfig(params.skillId, { thumbPath: storagePath }, ctx.profile.id);
    const signed = await createSignedStorageUrl(storagePath, "ui");
    const skills = await listCatalogSkills();
    const skill = skills.find((s) => s.id === params.skillId);
    return NextResponse.json({ skill, thumb: signed.url });
  });
}
