import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { listModelConfigs } from "@/lib/model-configs-db";

// List all model configs (admin only). These contain provider/model IDs and safe
// parameters only — never secrets. Generation routes do not read these in Phase
// Admin 1 (see lib/model-configs-db.ts).
export const dynamic = "force-dynamic";

export async function GET() {
  return withAdmin(async () => {
    const models = await listModelConfigs();
    return NextResponse.json({ models });
  });
}
