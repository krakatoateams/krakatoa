import { NextRequest, NextResponse } from "next/server";
import { parseToolsQuery } from "@/lib/creations";
import { listUserCreations } from "@/lib/creations-db";
import { getSessionUserId } from "@/lib/resolve-user";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const tools = parseToolsQuery(searchParams.get("tool"));
    const mediaType = searchParams.get("mediaType");
    const limit = Math.min(
      200,
      Math.max(1, parseInt(searchParams.get("limit") || "100", 10) || 100)
    );

    const items = await listUserCreations(userId, {
      tools,
      mediaType:
        mediaType === "image" || mediaType === "video" ? mediaType : undefined,
      limit,
    });

    return NextResponse.json({ items });
  } catch (error: unknown) {
    console.error("[Creations History]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
