"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { getSupabaseAuthBrowser } from "@/lib/supabase-browser-auth";
import { Button } from "@/components/ui/Button";
import { AuthModalShell } from "./AuthModalShell";

type SessionState = "checking" | "valid" | "invalid";

/**
 * "Set new password" step — auto-opens over /dashboard when the password
 * reset email link lands back via ?resetPassword=1 (see
 * app/auth/callback/route.ts + ForgotPasswordForm's redirectTo). By the time
 * this mounts, the callback route has already exchanged the recovery code
 * for a session cookie, so this just confirms that session and lets the
 * user set a new password without a dedicated page.
 */
function ResetPasswordModalInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = getSupabaseAuthBrowser();

  const [open, setOpen] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (searchParams.get("resetPassword") !== "1") return;
    setOpen(true);
    supabase.auth.getSession().then(({ data }) => {
      setSessionState(data.session ? "valid" : "invalid");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() {
    setOpen(false);
    // Strip the query param so a refresh or Back doesn't reopen this.
    router.replace("/dashboard");
  }

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

    setLoading(false);
    setDone(true);
  }

  return (
    <AuthModalShell open={open} onClose={close} ariaLabel="Reset password">
      {sessionState === "checking" && (
        <div className="py-8 text-center text-body-3 text-text-secondary">Checking link…</div>
      )}

      {sessionState === "invalid" && (
        <div className="space-y-4 text-center">
          <h1 className="font-display text-xl font-bold text-text-primary">Invalid link</h1>
          <p className="text-body-3 text-text-secondary">This link is invalid or has expired.</p>
          <Link
            href="/forgot-password"
            className="block text-body-3 text-brand-primary hover:text-brand-primary-hover"
          >
            Request a new password reset link
          </Link>
        </div>
      )}

      {sessionState === "valid" && done && (
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/20">
            <CheckCircle2 className="h-6 w-6 text-success" />
          </div>
          <h2 className="font-display text-lg font-semibold text-text-primary">Password updated</h2>
          <p className="text-body-3 text-text-secondary">
            Your password has been changed successfully.
          </p>
          <Button variant="primary" size="md" className="w-full" onClick={close}>
            Continue to dashboard
          </Button>
        </div>
      )}

      {sessionState === "valid" && !done && (
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-xl font-bold text-text-primary">Create a new password</h1>
            <p className="mt-1 text-body-3 text-text-secondary">Enter your new password below.</p>
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
      )}
    </AuthModalShell>
  );
}

export function ResetPasswordModal() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordModalInner />
    </Suspense>
  );
}
