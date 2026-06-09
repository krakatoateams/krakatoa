import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { addAdmin, listAdmins, type AdminRole } from "@/lib/admin-users-db";

// Admin access management. GET lists all admins; POST adds (or re-activates) one.
// Both require an active admin. admin_users is the source of truth.
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  return withAdmin(async () => {
    const admins = await listAdmins();
    return NextResponse.json({ admins });
  });
}

export async function POST(req: Request) {
  return withAdmin(async (ctx) => {
    let body: { email?: unknown; role?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
    }

    const role: AdminRole = body.role === "owner" ? "owner" : "admin";

    const admin = await addAdmin({
      email,
      role,
      grantedByProfileId: ctx.profile.id,
    });
    return NextResponse.json({ admin }, { status: 201 });
  });
}
