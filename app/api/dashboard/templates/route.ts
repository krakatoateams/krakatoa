import { NextResponse } from "next/server";
import { getPublicDashboardTemplateCatalog } from "@/lib/dashboard-templates-db";

export const dynamic = "force-dynamic";

/** Public dashboard carousel templates (viral + motion control). */
export async function GET() {
  const templates = await getPublicDashboardTemplateCatalog();
  return NextResponse.json(templates);
}
