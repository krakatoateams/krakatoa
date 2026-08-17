"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseAuthBrowser } from "@/lib/supabase-browser-auth";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/Button";

// Standalone fallback route — the primary flow is now the in-place
// ForgotPasswordForm view inside SignInModal (opened via "Forgot password?"
// there), which never navigates away. This page is still reachable directly
// and is where app/auth/callback/route.ts sends an expired/reused reset
// link, since that failure has no app page to reopen a modal over.
function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const expired = searchParams.get("error") === "expired";

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const supabase = getSupabaseAuthBrowser();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    // Always resolve to the same generic success state, regardless of
    // whether the email is registered or the call errors (e.g. rate
    // limit) — password reset is a more direct account-takeover vector
    // than login, so unlike login's Case A+C this never distinguishes.
    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
    } catch {
      // Fail closed to the same success state.
    }

    setLoading(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <AuthLayout>
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/20">
            <svg
              className="h-6 w-6 text-success"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 className="font-display text-lg font-semibold text-text-primary">Check your email!</h2>
          <p className="text-body-3 text-text-secondary">
            If <strong className="text-text-primary">{email}</strong> is registered, we&apos;ve
            sent a password reset link to that address.
          </p>
          <Link href="/login" className="block text-body-3 text-brand-primary hover:text-brand-primary-hover">
            Back to login
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-xl font-bold text-text-primary">Forgot password?</h1>
          <p className="mt-1 text-body-3 text-text-secondary">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>
        </div>

        {expired && (
          <div className="rounded-radius-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-small text-warning">
            This password reset link has expired or was already used. Request a new one
            below.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-small font-medium text-text-secondary">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-radius-xl border border-white/10 bg-white/10 px-3 py-2 text-body-3 text-text-primary placeholder-text-disabled outline-none focus:border-brand-primary"
            />
          </div>

          <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
            Send reset link
          </Button>
        </form>

        <p className="text-center text-body-3 text-text-secondary">
          <Link href="/login" className="text-brand-primary hover:text-brand-primary-hover">
            Back to login
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}
