import { NextRequest, NextResponse } from "next/server";
import { parseToolsQuery } from "@/lib/creations";
import { countUserCreationsByTab, listUserCreationsPage } from "@/lib/creations-db";
import { reconcileProductPhotosFromStorage } from "@/lib/product-photo-storage";
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
    // Active-tab tool filter (e.g. the Storyboards tab). It narrows the listing
    // only; the pill counts stay scoped to `tools` so switching tabs never shifts
    // them. When both are present, the listing uses their intersection.
    const tabTools = parseToolsQuery(searchParams.get("tabTool"));
    const listTools = tabTools?.length
      ? tools?.length
        ? tools.filter((t) => tabTools.includes(t))
        : tabTools
      : tools;
    const mediaTypeRaw = searchParams.get("mediaType");
    const mediaType =
      mediaTypeRaw === "image" || mediaTypeRaw === "video" ? mediaTypeRaw : undefined;
    const kind = searchParams.get("kind")?.trim() || undefined;
    const trashed = searchParams.get("trashed") === "1";
    const limit = Math.min(
      200,
      Math.max(1, parseInt(searchParams.get("limit") || "100", 10) || 100)
    );
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10) || 0);
    const wantsCounts = searchParams.get("counts") === "1";
    // Favorites are stored client-side (localStorage); the client passes the ids
    // it wants so the server can paginate them. An explicit empty list means "no
    // favorites" → return nothing rather than everything.
    const idsParam = searchParams.get("ids");
    const ids =
      idsParam === null
        ? undefined
        : idsParam.split(",").map((s) => s.trim()).filter(Boolean);

    // Best-effort self-heal: surface product photos that exist in Storage but
    // lack a DB row (e.g. created before the dual-write). Only on the first page
    // so paging through the library doesn't re-run it. Never blocks history.
    const wantsProductPhoto = !listTools?.length || listTools.includes("product_photo");
    if (wantsProductPhoto && offset === 0) {
      try {
        await reconcileProductPhotosFromStorage(userId);
      } catch (reconcileError) {
        console.warn(
          "[Creations History] product photo reconcile skipped:",
          reconcileError
        );
      }
    }

    if (ids && ids.length === 0) {
      return NextResponse.json({
        items: [],
        total: 0,
        ...(wantsCounts
          ? { counts: await countUserCreationsByTab(userId, { tools }) }
          : {}),
      });
    }

    const [{ items, total }, counts] = await Promise.all([
      listUserCreationsPage(userId, {
        tools: listTools,
        mediaType,
        kind,
        ids,
        offset,
        limit,
        trashed,
      }),
      wantsCounts ? countUserCreationsByTab(userId, { tools }) : Promise.resolve(null),
    ]);

    return NextResponse.json({ items, total, ...(counts ? { counts } : {}) });
  } catch (error: unknown) {
    console.error("[Creations History]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
