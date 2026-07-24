import { NextRequest, NextResponse } from "next/server";
import {
  SIGN_TTL,
  type SignTtlKind,
  requireSessionUserId,
  signAssetForUser,
  signStoragePathForUser,
} from "@/lib/storage-signed-url";

export const dynamic = "force-dynamic";

function parseTtl(raw: string | null): SignTtlKind | number {
  if (!raw) return "ui";
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && n <= SIGN_TTL.pipeline) return Math.floor(n);
  if (raw in SIGN_TTL) return raw as SignTtlKind;
  return "ui";
}

/** GET /api/storage/sign?path=... or ?assetId=... [&ttl=3600] */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireSessionUserId();
    const { searchParams } = new URL(req.url);
    const assetId = searchParams.get("assetId")?.trim();
    const path = searchParams.get("path")?.trim();
    const ttl = parseTtl(searchParams.get("ttl"));

    if (!assetId && !path) {
      return NextResponse.json({ error: "path or assetId is required." }, { status: 400 });
    }

    const signed = assetId
      ? await signAssetForUser(assetId, userId, ttl)
      : await signStoragePathForUser(path!, userId, ttl);

    return NextResponse.json(signed);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not authenticated/i.test(message)
      ? 401
      : /forbidden|invalid storage/i.test(message)
        ? 403
        : /not found/i.test(message)
          ? 404
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
