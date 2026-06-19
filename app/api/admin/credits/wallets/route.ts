import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { getAdminWallets } from "@/lib/admin-metrics-db";

// Active admins with their current dummy-credit balances. Powers the admin
// Credits tab (per-admin reset / top-up). Admin-gated, read-only.
export const dynamic = "force-dynamic";

export async function GET() {
  return withAdmin(async () => {
    const wallets = await getAdminWallets();
    return NextResponse.json({ wallets });
  });
}
