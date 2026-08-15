"use client";

import { useState } from "react";
import { getSupabaseAuthBrowser } from "@/lib/supabase-browser-auth";
import { Button } from "@/components/ui/Button";

/**
 * "Request a reset link" step, shown as a view inside SignInModal (see
 * onBackToSignIn) so it never leaves the page. app/forgot-password/page.tsx
 * stays as a standalone fallback for direct links and the expired-link
 * redirect from app/auth/callback/route.ts — same pattern as /login.
 */
export function ForgotPasswordForm({ onBackToSignIn }: { onBackToSignIn: () => void }) {
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
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/dashboard?resetPassword=1")}`,
      });
    } catch {
      // Fail closed to the same success state.
    }

    setLoading(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/20">
          <svg
            className="h-6 w-6 text-success"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="font-display text-lg font-semibold text-text-primary">Check your email!</h2>
        <p className="text-body-3 text-text-secondary">
          If <strong className="text-text-primary">{email}</strong> is registered, we&apos;ve
          sent a password reset link to that address.
        </p>
        <button
          type="button"
          onClick={onBackToSignIn}
          className="text-body-3 text-brand-primary hover:text-brand-primary-hover"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-text-primary">Forgot password?</h1>
        <p className="mt-1 text-body-3 text-text-secondary">
          Enter your email and we&apos;ll send you a link to reset your password.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-small font-medium text-text-secondary">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full rounded-radius-md border border-white/10 bg-white/10 px-3 py-2 text-body-3 text-text-primary placeholder-text-disabled outline-none focus:border-brand-primary"
          />
        </div>

        <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
          Send reset link
        </Button>
      </form>

      <p className="text-center text-body-3 text-text-secondary">
        <button
          type="button"
          onClick={onBackToSignIn}
          className="text-brand-primary hover:text-brand-primary-hover"
        >
          Back to sign in
        </button>
      </p>
    </div>
  );
}
