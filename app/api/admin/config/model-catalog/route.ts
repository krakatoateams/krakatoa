import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { ensureModelCatalogRows } from "@/lib/model-catalog-configs-db";

export const dynamic = "force-dynamic";

export async function GET() {
  return withAdmin(async () => {
    const modelCatalog = await ensureModelCatalogRows();
    return NextResponse.json({ modelCatalog });
  });
}
