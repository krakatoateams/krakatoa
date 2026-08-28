import { NextRequest, NextResponse } from "next/server";
import { parseToolsQuery } from "@/lib/creations";
import type { MediaScope } from "@/lib/creation-library-filters";
import {
  isProductMediaScope,
  libraryQueryFromFeature,
  type LibraryFeatureId,
  type ProductMediaScope,
} from "@/lib/creation-library-filters";
import {
  countLibraryFeatureCounts,
  countUserCreationsByTab,
  listUserCreationsPage,
  signCreationItemsMedia,
  type CreationPageFilters,
} from "@/lib/creations-db";
import { reconcileProductPhotosFromStorage } from "@/lib/product-photo-storage";
import { getSessionUserId } from "@/lib/resolve-user";

export const dynamic = "force-dynamic";

function intersectTools(
  outer: ReturnType<typeof parseToolsQuery>,
  inner: ReturnType<typeof parseToolsQuery>
) {
  if (!inner?.length) return outer;
  if (!outer?.length) return inner;
  const tools = inner.filter((t) => outer.includes(t));
  return tools.length ? tools : [];
}

function libraryListingFilters(
  scope: ProductMediaScope,
  featureId: LibraryFeatureId,
  tools: ReturnType<typeof parseToolsQuery>
): CreationPageFilters {
  const base = libraryQueryFromFeature(scope, featureId);
  if (!base) return { tools: tools?.length ? tools : undefined };
  if (base.photoStudioAll || base.videoStudioAll) {
    return {
      mediaType: base.mediaType,
      kind: base.kind,
      photoMode: base.photoMode,
      viralTemplate: base.viralTemplate,
      trashed: base.trashed,
      photoStudioAll: base.photoStudioAll,
      videoStudioAll: base.videoStudioAll,
    };
  }

  const mergedTools =
    base.photoMode && !base.tools?.length
      ? undefined
      : intersectTools(tools, base.tools);

  return {
    tools: mergedTools,
    mediaType: base.mediaType,
    kind: base.kind,
    photoMode: base.photoMode,
    viralTemplate: base.viralTemplate,
    trashed: base.trashed,
  };
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const tools = parseToolsQuery(searchParams.get("tool"));
    const libraryScopeRaw = searchParams.get("libraryScope");
    const libraryScope: MediaScope | undefined =
      libraryScopeRaw === "photo" ||
      libraryScopeRaw === "video" ||
      libraryScopeRaw === "all"
        ? libraryScopeRaw
        : undefined;
    const librarySectionRaw = searchParams.get("librarySection");
    const librarySection =
      librarySectionRaw === "favorite" || librarySectionRaw === "trash"
        ? librarySectionRaw
        : "browse";
    const libraryFeature = (searchParams.get("libraryFeature")?.trim() ||
      "all") as LibraryFeatureId;

    // Legacy tab filters (tool pickers + older library chips).
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
    const wantsLibraryCounts = searchParams.get("libraryCounts") === "1";
    const idsParam = searchParams.get("ids");
    const ids =
      idsParam === null
        ? undefined
        : idsParam.split(",").map((s) => s.trim()).filter(Boolean);

    const useLibraryFilters = Boolean(libraryScope);
    const productFeatureId =
      libraryFeature === "favorite" || libraryFeature === "trash"
        ? "all"
        : libraryFeature;
    const pageFilters: CreationPageFilters = useLibraryFilters
      ? libraryScope === "all"
        ? {
            tools: tools?.length ? tools : undefined,
            ...(librarySection === "favorite" ? { ids } : {}),
            ...(librarySection === "trash" ? { trashed: true } : {}),
          }
        : isProductMediaScope(libraryScope!)
          ? {
              ...libraryListingFilters(libraryScope, productFeatureId, tools),
              ...(librarySection === "favorite"
                ? {
                    mediaType: libraryScope === "photo" ? "image" : "video",
                    ids,
                  }
                : {}),
              ...(librarySection === "trash" ? { trashed: true } : {}),
            }
          : { tools: tools?.length ? tools : undefined }
      : {
          tools: listTools,
          mediaType,
          kind,
          ids,
          trashed,
        };

    const wantsProductPhoto =
      !pageFilters.tools?.length || pageFilters.tools.includes("product_photo");
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
        ...(wantsLibraryCounts
          ? { libraryCounts: await countLibraryFeatureCounts(userId, { tools }) }
          : wantsCounts
            ? { counts: await countUserCreationsByTab(userId, { tools }) }
            : {}),
      });
    }

    const [{ items, total }, libraryCounts, legacyCounts] = await Promise.all([
      listUserCreationsPage(userId, {
        ...pageFilters,
        offset,
        limit,
      }),
      wantsLibraryCounts
        ? countLibraryFeatureCounts(userId, { tools })
        : Promise.resolve(null),
      wantsCounts && !wantsLibraryCounts
        ? countUserCreationsByTab(userId, { tools })
        : Promise.resolve(null),
    ]);

    const signedItems = await signCreationItemsMedia(userId, items);
    return NextResponse.json({
      items: signedItems,
      total,
      ...(libraryCounts ? { libraryCounts } : {}),
      ...(legacyCounts ? { counts: legacyCounts } : {}),
    });
  } catch (error: unknown) {
    console.error("[Creations History]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
