import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/resolve-user";
import { supabaseServer } from "@/lib/supabase-server";
import { STORYBOARDS_TABLE } from "@/lib/storage-buckets";
import { resolveSignedMediaUrl } from "@/lib/storage-signed-url";

export const dynamic = "force-dynamic";

/** GET /api/storyboards — storyboards for the signed-in user (newest first). */
export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { data, error } = await supabaseServer
      .from(STORYBOARDS_TABLE)
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const storyboards = await Promise.all(
      (data ?? []).map(async (row) => {
        const r = row as Record<string, unknown>;
        try {
          const [storyboardUrl, videoUrl] = await Promise.all([
            resolveSignedMediaUrl({ userId, mediaUrl: r.storyboard_url as string }),
            resolveSignedMediaUrl({ userId, mediaUrl: r.video_url as string | null }),
          ]);
          return {
            ...r,
            storyboard_url: storyboardUrl ?? r.storyboard_url,
            video_url: videoUrl ?? r.video_url,
          };
        } catch (err: unknown) {
          console.warn(
            "[storyboards] sign failed:",
            r.id,
            err instanceof Error ? err.message : err,
          );
          return r;
        }
      }),
    );
    return NextResponse.json({ storyboards });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
