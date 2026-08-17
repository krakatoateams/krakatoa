"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseAuthBrowser } from "@/lib/supabase-browser-auth";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/Button";

type SessionState = "checking" | "valid" | "invalid";

// Standalone fallback route, kept only for reset-password emails sent
// before the flow moved into ResetPasswordModal (auto-opened over
// /dashboard via ?resetPassword=1 — see ForgotPasswordForm's redirectTo and
// app/auth/callback/route.ts). New reset links never land here.
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = getSupabaseAuthBrowser();

  const [sessionState, setSessionState] = useState<SessionState>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // By the time this page loads, app/auth/callback/route.ts should have
    // already exchanged the recovery code for a session cookie. No session
    // here means the user landed directly (not via a valid email link).
    supabase.auth.getSession().then(({ data }) => {
      setSessionState(data.session ? "valid" : "invalid");
    });
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Password and confirmation don't match.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setLoading(false);
      // Mirrors signup's Case F (weak password) — Supabase's message is
      // already user-friendly, shown as-is.
      setError(updateError.message);
      return;
    }

    // The recovery session is already active (cookie set by the callback
    // route) — send the user straight in rather than making them log in
    // again with the password they just typed twice.
    router.push("/dashboard");
  }

  if (sessionState === "checking") {
    return (
      <AuthLayout>
        <div className="py-8 text-center text-body-3 text-text-secondary">Checking link…</div>
      </AuthLayout>
    );
  }

  if (sessionState === "invalid") {
    return (
      <AuthLayout>
        <div className="space-y-4 text-center">
          <h1 className="font-display text-xl font-bold text-text-primary">Invalid link</h1>
          <p className="text-body-3 text-text-secondary">
            This link is invalid or has expired.
          </p>
          <Link
            href="/forgot-password"
            className="block text-body-3 text-brand-primary hover:text-brand-primary-hover"
          >
            Request a new password reset link
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-xl font-bold text-text-primary">Create a new password</h1>
          <p className="mt-1 text-body-3 text-text-secondary">
            Enter your new password below.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-small font-medium text-text-secondary">
              New password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full rounded-radius-xl border border-white/10 bg-white/10 px-3 py-2 text-body-3 text-text-primary placeholder-text-disabled outline-none focus:border-brand-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-small font-medium text-text-secondary">
              Confirm password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full rounded-radius-xl border border-white/10 bg-white/10 px-3 py-2 text-body-3 text-text-primary placeholder-text-disabled outline-none focus:border-brand-primary"
            />
          </div>

          {error && (
            <div className="rounded-radius-md border border-error/30 bg-error/10 px-3 py-2.5 text-small text-error">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
            Save new password
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}
