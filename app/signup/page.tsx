"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseAuthBrowser } from "@/lib/supabase-browser-auth";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/Button";

type SignupError =
  | { kind: "duplicate_google" }
  | { kind: "duplicate_email" }
  | { kind: "other"; message: string };

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
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

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signupError, setSignupError] = useState<SignupError | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const supabase = getSupabaseAuthBrowser();

  async function handleGoogleSignIn() {
    setSignupError(null);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
        // Forces Google's account chooser every time — see SignInForm.tsx's
        // handleGoogleSignIn for why this is needed.
        queryParams: { prompt: "select_account" },
      },
    });
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setSignupError(null);
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("already registered") || msg.includes("already exists")) {
        // Keep loading=true during the provider check to avoid a UI flash.
        const isGoogleOnly = await checkIsGoogleOnly(email);
        setLoading(false);
        setSignupError({ kind: isGoogleOnly ? "duplicate_google" : "duplicate_email" });
      } else {
        // Includes Case F (weak password): Supabase's message is already user-friendly.
        setLoading(false);
        setSignupError({ kind: "other", message: error.message });
      }
      return;
    }

    // With email confirmation enabled, Supabase returns success for duplicate
    // emails but sets identities = [] on the returned user object.
    if (data.user?.identities?.length === 0) {
      // Keep loading=true during the provider check to avoid a UI flash.
      const isGoogleOnly = await checkIsGoogleOnly(email);
      setLoading(false);
      setSignupError({ kind: isGoogleOnly ? "duplicate_google" : "duplicate_email" });
      return;
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
            We&apos;ve sent a verification link to{" "}
            <strong className="text-text-primary">{email}</strong>. Click the link to
            activate your account.
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
          <h1 className="font-display text-xl font-bold text-text-primary">Create an account</h1>
          <p className="mt-1 text-body-3 text-text-secondary">
            Already have an account?{" "}
            <Link href="/login" className="text-brand-primary hover:text-brand-primary-hover">
              Log in here
            </Link>
          </p>
        </div>

        {/* Google */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          className="flex w-full items-center justify-center gap-3 rounded-radius-xl border border-white/10 bg-white/10 px-4 py-2.5 text-body-3 font-medium text-text-primary transition-colors hover:bg-white/20 disabled:opacity-50"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-small text-text-disabled">or</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={handleSignUp} className="space-y-3">
          <div>
            <label className="mb-1 block text-small font-medium text-text-secondary">
              Full name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              autoComplete="name"
              placeholder="Your name"
              className="w-full rounded-radius-xl border border-white/10 bg-white/10 px-3 py-2 text-body-3 text-text-primary placeholder-text-disabled outline-none focus:border-brand-primary"
            />
          </div>
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
          <div>
            <label className="mb-1 block text-small font-medium text-text-secondary">
              Password
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

          {/* Error states */}
          {signupError?.kind === "duplicate_google" && (
            <div className="space-y-3 rounded-radius-md border border-warning/30 bg-warning/10 px-3 py-3">
              <div>
                <p className="text-small font-medium text-warning">
                  This email is already registered with Google.
                </p>
                <p className="mt-0.5 text-small text-warning/70">
                  Log in directly with the button below.
                </p>
              </div>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="flex w-full items-center justify-center gap-2.5 rounded-radius-xl bg-white px-4 py-2 text-body-3 font-medium text-gray-900 transition-colors hover:bg-gray-100"
              >
                <GoogleIcon />
                Continue with Google
              </button>
            </div>
          )}

          {signupError?.kind === "duplicate_email" && (
            <div className="rounded-radius-md border border-error/30 bg-error/10 px-3 py-2.5 text-small text-error">
              This email is already registered. Already have an account?{" "}
              <Link
                href={`/login?email=${encodeURIComponent(email)}`}
                className="underline hover:text-white"
              >
                Log in here
              </Link>
            </div>
          )}

          {signupError?.kind === "other" && (
            <div className="rounded-radius-md border border-error/30 bg-error/10 px-3 py-2 text-small text-error">
              {signupError.message}
            </div>
          )}

          <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
            Create account
          </Button>

          <p className="text-center text-small text-text-secondary">
            By creating an account, you agree to our{" "}
            <Link href="/terms" target="_blank" className="text-text-secondary underline hover:text-text-primary">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank" className="text-text-secondary underline hover:text-text-primary">
              Privacy Policy
            </Link>
            .
          </p>
        </form>
      </div>
    </AuthLayout>
  );
}
