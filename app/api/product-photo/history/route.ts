import { NextResponse } from "next/server";
import { listProductPhotoHistory } from "@/lib/product-photo-storage";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("clientId")?.trim();

    if (!clientId || clientId.length > 64) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    const items = await listProductPhotoHistory(clientId);
    return NextResponse.json({ items });
  } catch (error: unknown) {
    console.error("[Product Photo History] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
