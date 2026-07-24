import { NextResponse } from "next/server";
import { listProductPhotoGenerationsForUser } from "@/lib/product-photo-db";
import { signCreationItemsMedia } from "@/lib/creations-db";
import { getSessionUserId } from "@/lib/resolve-user";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const raw = await listProductPhotoGenerationsForUser(userId);
    const items = await signCreationItemsMedia(
      userId,
      raw.map((item) => ({
        id: item.id,
        tool: "product_photo" as const,
        toolLabel: "Product Photo",
        mediaType: "image" as const,
        mediaUrl: item.imageUrl,
        storagePath: item.storagePath,
        title: `${item.poseLabel} · ${item.styleLabel}`,
        createdAt: item.createdAt,
        metadata: {
          poseId: item.poseId,
          styleId: item.styleId,
          poseLabel: item.poseLabel,
          styleLabel: item.styleLabel,
        },
      })),
    );

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        imageUrl: item.mediaUrl,
        storagePath: item.storagePath,
        poseId: item.metadata.poseId,
        styleId: item.metadata.styleId,
        poseLabel: item.metadata.poseLabel,
        styleLabel: item.metadata.styleLabel,
        createdAt: item.createdAt,
      })),
    });
  } catch (error: unknown) {
    console.error("[Product Photo History] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
