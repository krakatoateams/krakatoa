import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/admin-auth";

// Visibility-only endpoint for the client sidebar. It is NOT a security boundary
// — the real gate is requireAdmin() on every admin page/API. Returns 200 with
// { isAdmin: false } for unauthenticated/non-admin callers so the sidebar never
// surfaces an error.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const current = await getCurrentAdmin();
    if (!current) {
      return NextResponse.json({ isAdmin: false });
    }
    return NextResponse.json({
      isAdmin: true,
      role: current.admin.role,
      email: current.admin.email,
    });
  } catch (e) {
    console.error("[admin/me] failed:", e);
    return NextResponse.json({ isAdmin: false });
  }
}
