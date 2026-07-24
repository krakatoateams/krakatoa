import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/profiles-db";
import { listActiveTrendingTemplates } from "@/lib/trending-templates-db";

// Trending Templates for the dashboard carousel. Any signed-in user may read
// this — it's global showcase content, not per-profile data. Served via the
// service role (see lib/trending-templates-db.ts).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const templates = await listActiveTrendingTemplates();
    return NextResponse.json({
      templates: templates.map((t) => ({
        id: t.id,
        videoUrl: t.video_url,
        thumbnailUrl: t.thumbnail_url,
      })),
    });
  } catch (e) {
    console.error("[templates/trending] failed:", e);
    return NextResponse.json(
      { error: "Failed to load trending templates." },
      { status: 500 }
    );
  }
}
