import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

const BUCKET = "videos";
const MAX_BYTES = 200 * 1024 * 1024; // 200 MB ceiling

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    if (file.type !== "video/mp4") {
      return NextResponse.json(
        { error: "Only MP4 files are accepted." },
        { status: 400 },
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File exceeds the 200 MB limit." },
        { status: 413 },
      );
    }

    // Sanitise filename and make it unique
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${Date.now()}-${safeName}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { data, error } = await supabaseServer.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: "video/mp4",
        upsert: false,
      });

    if (error) {
      console.error("[upload]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: urlData } = supabaseServer.storage
      .from(BUCKET)
      .getPublicUrl(data.path);

    return NextResponse.json({ url: urlData.publicUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Upload failed.";
    console.error("[upload]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
