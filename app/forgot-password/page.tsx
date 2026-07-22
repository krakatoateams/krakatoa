"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseAuthBrowser } from "@/lib/supabase-browser-auth";
import { AuthLayout } from "@/components/auth/AuthLayout";

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
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20">
            <svg
              className="h-6 w-6 text-green-400"
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
          <h2 className="font-display text-lg font-semibold text-white">Check your email!</h2>
          <p className="text-sm text-gray-400">
            If <strong className="text-white">{email}</strong> is registered, we&apos;ve
            sent a password reset link to that address.
          </p>
          <Link href="/login" className="block text-sm text-[#F26522] hover:text-[#e05a1a]">
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
          <h1 className="font-display text-xl font-bold text-white">Forgot password?</h1>
          <p className="mt-1 text-sm text-gray-400">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>
        </div>

        {expired && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-400">
            This password reset link has expired or was already used. Request a new one
            below.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-[#F26522]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-[#F26522] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#e05a1a] disabled:opacity-50"
          >
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400">
          <Link href="/login" className="text-[#F26522] hover:text-[#e05a1a]">
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
