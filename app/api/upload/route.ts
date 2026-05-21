import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { STORAGE_BUCKET, videosStoragePath } from "@/lib/storage-buckets";

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB ceiling

const ACCEPTED_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",   // .mov
  "video/avi",
  "video/x-msvideo",  // .avi (alternative MIME)
]);

export async function POST(req: NextRequest) {
  console.log("[upload] NEXT_PUBLIC_SUPABASE_URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log("[upload] Using bucket:", STORAGE_BUCKET);
  console.log("[upload] Using key type: SUPABASE_SERVICE_ROLE_KEY (service role)");

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    if (!ACCEPTED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Only MP4, MOV, and AVI files are accepted." },
        { status: 400 },
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File exceeds the 200 MB limit." },
        { status: 413 },
      );
    }

    // Sanitise filename and make it unique, placed under videos/ folder
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = videosStoragePath(`${Date.now()}-${safeName}`);
    console.log("[upload] Uploading to path:", storagePath);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { data, error } = await supabaseServer.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (error) {
      console.error("[upload] Storage error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: urlData } = supabaseServer.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(data.path);

    console.log("[upload] Success, public URL:", urlData.publicUrl);
    return NextResponse.json({ url: urlData.publicUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    console.error("[upload] Unexpected error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
