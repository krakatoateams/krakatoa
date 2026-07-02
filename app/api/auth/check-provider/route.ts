import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/auth/check-provider
 * Body: { email: string }
 * Returns: { isGoogleOnly: boolean }
 *
 * Called only after a failed signInWithPassword to distinguish a Google-only
 * account (Case B) from wrong-password / non-existent (Cases A+C). This
 * intentionally trades a mild user-enumeration risk for a better UX on the
 * common "signed up with Google, tried email+password" path. The endpoint
 * fails open (returns isGoogleOnly: false) on any error so the generic
 * "wrong credentials" fallback is always shown in worst case.
 *
 * NOTE: GoTrue's GET /auth/v1/admin/users does NOT support email filtering —
 * the ?email= param is silently ignored and users are returned in DB order.
 * We use the JS admin client (listUsers + in-memory find) instead.
 */
export async function POST(req: NextRequest) {
  let email: string;
  try {
    const body = (await req.json()) as { email?: unknown };
    if (typeof body.email !== "string" || !body.email.trim()) {
      return NextResponse.json({ isGoogleOnly: false });
    }
    email = body.email.trim().toLowerCase();
  } catch {
    return NextResponse.json({ isGoogleOnly: false });
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // listUsers does not support email filtering — fetch all users and match.
    // 1000 is a safe ceiling for any realistic user count at this stage.
    const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (error) return NextResponse.json({ isGoogleOnly: false });

    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (!user) return NextResponse.json({ isGoogleOnly: false });

    // app_metadata.providers is the authoritative list Supabase Auth maintains.
    const providers = (user.app_metadata?.providers as string[] | undefined) ?? [];
    const isGoogleOnly = providers.includes("google") && !providers.includes("email");

    return NextResponse.json({ isGoogleOnly });
  } catch {
    return NextResponse.json({ isGoogleOnly: false });
  }
}
