import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { updateModelCatalogConfig } from "@/lib/model-catalog-configs-db";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withAdmin(async (ctx) => {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (!("enabled" in body) || typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "`enabled` must be a boolean." }, { status: 400 });
    }

    const modelCatalog = await updateModelCatalogConfig(
      params.id,
      { enabled: body.enabled },
      ctx.profile.id
    );
    if (!modelCatalog) {
      return NextResponse.json({ error: "Model catalog config not found." }, { status: 404 });
    }
    return NextResponse.json({ modelCatalog });
  });
}
