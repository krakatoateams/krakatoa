"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { SignInForm } from "@/components/auth/SignInForm";
import { sanitizeNextPath } from "@/lib/safe-redirect";

// Kept as a standalone fallback route (direct links, bookmarks, the
// `next=`/email-confirmation flows) even though in-app sign-in now happens
// via SignInModal — nothing in the app links here anymore, see
// kelolako-dashboard-nonlogin-plan.
function LoginPageContent() {
  const searchParams = useSearchParams();
  const next = sanitizeNextPath(searchParams.get("next"));
  // Set by app/auth/callback/route.ts when exchangeCodeForSession() fails
  // (e.g. a stale/reused OAuth code) — previously redirected here silently
  // with no message at all.
  const callbackError = searchParams.get("error");

  return (
    <AuthLayout>
      <SignInForm
        next={next}
        callbackError={callbackError}
        initialEmail={searchParams.get("email") ?? ""}
      />
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageContent />
    </Suspense>
  );
}
