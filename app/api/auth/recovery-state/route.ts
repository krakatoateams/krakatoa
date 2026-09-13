import { NextRequest, NextResponse } from "next/server";
import {
  PASSWORD_RECOVERY_PROOF_COOKIE,
  passwordRecoveryDestinationFromProof,
} from "@/lib/password-recovery";
import { SUPABASE_AUTH_CACHE_HEADERS } from "@/lib/supabase-auth-response";
import { createSupabaseAuthServer } from "@/lib/supabase-auth-server";

function recoveryJson(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(
    body,
    { status, headers: SUPABASE_AUTH_CACHE_HEADERS },
  );
}

function recoveryDestination(request: NextRequest): string | null {
  return passwordRecoveryDestinationFromProof(
    request.cookies.get(PASSWORD_RECOVERY_PROOF_COOKIE)?.value,
  );
}

function clearRecoveryProof(response: NextResponse): NextResponse {
  response.cookies.set(PASSWORD_RECOVERY_PROOF_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  return recoveryJson({ active: recoveryDestination(request) !== null });
}

export async function PATCH(request: NextRequest) {
  if (!recoveryDestination(request)) {
    return recoveryJson(
      { error: "Password recovery proof is missing." },
      403,
    );
  }

  let password: string;
  try {
    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password !== "string" || body.password.length < 6) {
      return recoveryJson(
        { error: "Password must be at least 6 characters." },
        400,
      );
    }
    password = body.password;
  } catch {
    return recoveryJson({ error: "Invalid request body." }, 400);
  }

  const supabase = await createSupabaseAuthServer();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) {
    return recoveryJson(
      { error: "Unable to validate the recovery session." },
      503,
    );
  }
  if (!user) {
    return recoveryJson({ error: "Recovery session is invalid." }, 401);
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return recoveryJson({ error: error.message }, 400);
  }

  return clearRecoveryProof(recoveryJson({ success: true }));
}

export async function DELETE(request: NextRequest) {
  if (!recoveryDestination(request)) {
    return clearRecoveryProof(recoveryJson({ active: false }));
  }

  const supabase = await createSupabaseAuthServer();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) {
    return recoveryJson(
      { error: "Unable to validate the recovery session." },
      503,
    );
  }
  if (user) {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      return recoveryJson(
        { error: "Unable to end the recovery session." },
        503,
      );
    }
  }

  return clearRecoveryProof(recoveryJson({ active: false }));
}
