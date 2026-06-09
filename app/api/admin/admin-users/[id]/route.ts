import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { revokeAdminById } from "@/lib/admin-users-db";

// Revoke (soft-remove) an admin by id. Keeps the row for audit. The DB helper
// refuses to revoke the last active admin (-> 409 via adminErrorResponse).
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  return withAdmin(async () => {
    const admin = await revokeAdminById(params.id);
    return NextResponse.json({ admin });
  });
}
