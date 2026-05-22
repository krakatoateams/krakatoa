import { NextResponse } from "next/server";
import { listProductPhotoGenerationsForUser } from "@/lib/product-photo-db";
import { getSessionUserId } from "@/lib/resolve-user";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const items = await listProductPhotoGenerationsForUser(userId);
    return NextResponse.json({ items });
  } catch (error: unknown) {
    console.error("[Product Photo History] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
