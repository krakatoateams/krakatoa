import { NextRequest, NextResponse } from "next/server";
import {
  SIGN_TTL,
  type SignTtlKind,
  type SignedStorageUrl,
  requireSessionUserId,
  signAssetForUser,
  signStoragePathForUser,
} from "@/lib/storage-signed-url";

export const dynamic = "force-dynamic";

type BatchItem = { assetId?: string; path?: string };

function parseTtl(raw: unknown): SignTtlKind | number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.floor(raw), SIGN_TTL.pipeline);
  }
  if (typeof raw === "string" && raw in SIGN_TTL) return raw as SignTtlKind;
  return "ui";
}

/** POST /api/storage/sign-batch { items: [{path}|{assetId}], ttl? } */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireSessionUserId();
    const body = (await req.json().catch(() => null)) as {
      items?: BatchItem[];
      ttl?: unknown;
    } | null;
    const items = Array.isArray(body?.items) ? body!.items : [];
    if (!items.length) {
      return NextResponse.json({ error: "items is required." }, { status: 400 });
    }
    if (items.length > 100) {
      return NextResponse.json({ error: "Max 100 items per batch." }, { status: 400 });
    }

    const ttl = parseTtl(body?.ttl);
    const results: Array<SignedStorageUrl | { error: string; assetId?: string; path?: string }> = [];

    for (const item of items) {
      try {
        if (item.assetId) {
          results.push(await signAssetForUser(item.assetId.trim(), userId, ttl));
        } else if (item.path) {
          results.push(await signStoragePathForUser(item.path.trim(), userId, ttl));
        } else {
          results.push({ error: "assetId or path required" });
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        results.push({ error: message, assetId: item.assetId, path: item.path });
      }
    }

    return NextResponse.json({ items: results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not authenticated/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
