"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseAuthBrowser } from "@/lib/supabase-browser-auth";
import { Button } from "@/components/ui/Button";
import { JUST_SIGNED_IN_FLAG } from "@/lib/pending-form-draft";

function flagJustSignedIn() {
  try {
    sessionStorage.setItem(JUST_SIGNED_IN_FLAG, "1");
  } catch {
    // ignore — private browsing etc., just means no toast
  }
}

type LoginError =
  | { kind: "invalid_credentials" }
  | { kind: "google_only" }
  | { kind: "email_not_confirmed" }
  | { kind: "other"; message: string };

function GoogleIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

async function checkIsGoogleOnly(email: string): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/check-provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { isGoogleOnly?: boolean };
    return Boolean(data.isGoogleOnly);
  } catch {
    return false;
  }
}

/**
 * Core sign-in form — Google OAuth + email/password, with the full set of
 * error states (wrong credentials, Google-only account, unconfirmed email).
 * Shared between the full-page `/login` route and `SignInModal`; deliberately
 * decoupled from `useSearchParams()` so it can be dropped into a modal
 * without needing to live under a route that has those params.
 */
export function SignInForm({
  next = "/dashboard",
  callbackError,
  initialEmail = "",
  onSuccess,
  onForgotPassword,
}: {
  next?: string;
  callbackError?: string | null;
  initialEmail?: string;
  onSuccess?: () => void;
  /**
   * When set (i.e. rendered inside SignInModal), "Forgot password?" swaps
   * the modal's view in-place instead of navigating. Omit this to fall back
   * to a real link to /forgot-password — used by the standalone /login page,
   * which has no modal view state to switch.
   */
  onForgotPassword?: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<LoginError | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  const supabase = getSupabaseAuthBrowser();

  async function handleGoogleSignIn() {
    setLoginError(null);
    // Optimistic — we're about to leave the page entirely for Google's
    // consent screen, so there's no later point to set this from.
    flagJustSignedIn();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        // Without this, Google silently reuses the browser's single active
        // session + prior consent and skips the chooser entirely — fine with
        // multiple Google accounts signed in (Google disambiguates on its
        // own), but with just one it auto-logs in with no way to pick a
        // different account.
        queryParams: { prompt: "select_account" },
      },
    });
  }

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setResendSuccess(false);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (!error) {
      flagJustSignedIn();
      onSuccess?.();
      // Keep loading=true — redirect is in flight
      router.push(next);
      return;
    }

    const code = (error as { code?: string }).code ?? "";
    const msg = error.message.toLowerCase();

    if (code === "email_not_confirmed" || msg.includes("email not confirmed")) {
      setLoading(false);
      setLoginError({ kind: "email_not_confirmed" });
    } else if (
      code === "invalid_credentials" ||
      msg.includes("invalid login credentials") ||
      msg.includes("invalid credentials")
    ) {
      // Keep loading=true while we check provider — seamless UX
      const isGoogleOnly = await checkIsGoogleOnly(email);
      setLoading(false);
      setLoginError(isGoogleOnly ? { kind: "google_only" } : { kind: "invalid_credentials" });
    } else {
      setLoading(false);
      setLoginError({ kind: "other", message: error.message });
    }
  }

  async function handleResendVerification() {
    setResending(true);
    setResendSuccess(false);
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setResending(false);
    if (!error) {
      setResendSuccess(true);
    } else {
      setLoginError({ kind: "other", message: error.message });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-text-primary">Sign in</h1>
        <p className="mt-1 text-body-3 text-text-secondary">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-brand-primary hover:text-brand-primary-hover">
            Sign up here
          </Link>
        </p>
      </div>

      {callbackError && (
        <div className="rounded-radius-md border border-error/30 bg-error/10 px-3 py-2.5 text-small text-error">
          Authentication failed, please try again.
        </div>
      )}

      {/* Google */}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        className="flex w-full items-center justify-center gap-3 rounded-radius-xl border border-white/10 bg-white/10 px-4 py-2.5 text-body-3 font-medium text-text-primary transition-colors hover:bg-white/20"
      >
        <GoogleIcon />
        Continue with Google
      </button>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-small text-text-disabled">or</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      {/* Email + password */}
      <form onSubmit={handleEmailSignIn} className="space-y-3">
        <div>
          <label className="mb-1 block text-small font-medium text-text-secondary">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full rounded-radius-xl border border-white/10 bg-white/10 px-3 py-2 text-body-3 text-text-primary placeholder-text-disabled outline-none focus:border-brand-primary"
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-small font-medium text-text-secondary">Password</label>
            {onForgotPassword ? (
              <button
                type="button"
                onClick={onForgotPassword}
                className="text-small text-brand-primary hover:text-brand-primary-hover"
              >
                Forgot password?
              </button>
            ) : (
              <Link href="/forgot-password" className="text-small text-brand-primary hover:text-brand-primary-hover">
                Forgot password?
              </Link>
            )}
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full rounded-radius-xl border border-white/10 bg-white/10 px-3 py-2 text-body-3 text-text-primary placeholder-text-disabled outline-none focus:border-brand-primary"
          />
        </div>

        {/* Case B — Google-only account */}
        {loginError?.kind === "google_only" && (
          <div className="space-y-3 rounded-radius-md border border-warning/30 bg-warning/10 px-3 py-3">
            <div>
              <p className="text-small font-medium text-warning">
                Looks like you signed up with Google.
              </p>
              <p className="mt-0.5 text-small text-warning/70">
                This account doesn&apos;t have a password — try logging in with Google instead.
              </p>
            </div>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="flex w-full items-center justify-center gap-2.5 rounded-radius-xl bg-white px-4 py-2 text-body-3 font-medium text-gray-900 transition-colors hover:bg-gray-100"
            >
              <GoogleIcon className="h-4 w-4" />
              Continue with Google
            </button>
          </div>
        )}

        {/* Cases A + C — wrong credentials / not registered */}
        {loginError?.kind === "invalid_credentials" && (
          <div className="rounded-radius-md border border-error/30 bg-error/10 px-3 py-2.5 text-small text-error">
            Wrong email or password. Don&apos;t have an account?{" "}
            <Link href="/signup" className="underline hover:text-white">
              Sign up here
            </Link>
          </div>
        )}

        {/* Case D — email not confirmed */}
        {loginError?.kind === "email_not_confirmed" && (
          <div className="space-y-2 rounded-radius-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-small text-warning">
            <p>Please check your email to verify your account first.</p>
            {resendSuccess ? (
              <p className="text-success">Verification email resent successfully!</p>
            ) : (
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resending}
                className="mt-1 w-full rounded-radius-xl border border-warning/40 bg-warning/10 px-3 py-1.5 text-small font-medium text-warning transition-colors hover:bg-warning/20 disabled:opacity-50"
              >
                {resending ? "Sending…" : "Resend verification email"}
              </button>
            )}
          </div>
        )}

        {/* Other errors */}
        {loginError?.kind === "other" && (
          <div className="rounded-radius-md border border-error/30 bg-error/10 px-3 py-2 text-small text-error">
            {loginError.message}
          </div>
        )}

        <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
          Sign in
        </Button>
      </form>
    </div>
  );
}
