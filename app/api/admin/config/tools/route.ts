import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { listToolConfigs } from "@/lib/tool-configs-db";

// List all tool configs (admin only).
export const dynamic = "force-dynamic";

export async function GET() {
  return withAdmin(async () => {
    const tools = await listToolConfigs();
    return NextResponse.json({ tools });
  });
}
