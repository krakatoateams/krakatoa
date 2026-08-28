"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { sanitizeNextPath } from "@/lib/safe-redirect";

// Kept as a standalone fallback route (direct links, bookmarks) even though
// in-app sign-up now happens via SignInModal's "signup" view — nothing in
// the app links here anymore, see kelolako-dashboard-nonlogin-plan and
// app/login/page.tsx's matching comment.
function SignupPageContent() {
  const searchParams = useSearchParams();
  const next = sanitizeNextPath(searchParams.get("next"));

  return (
    <AuthLayout>
      <SignUpForm next={next} />
    </AuthLayout>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupPageContent />
    </Suspense>
  );
}
