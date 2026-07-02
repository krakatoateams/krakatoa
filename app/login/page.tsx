"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseAuthBrowser } from "@/lib/supabase-browser-auth";

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

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<LoginError | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  const supabase = getSupabaseAuthBrowser();

  async function handleGoogleSignIn() {
    setLoginError(null);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
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
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-gray-800 bg-gray-900 p-8">
        <div>
          <h1 className="text-xl font-bold text-white">Sign in</h1>
          <p className="mt-1 text-sm text-gray-400">
            Belum punya akun?{" "}
            <Link href="/signup" className="text-violet-400 hover:text-violet-300">
              Daftar di sini
            </Link>
          </p>
        </div>

        {/* Google */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-700"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-800" />
          <span className="text-xs text-gray-600">atau</span>
          <div className="h-px flex-1 bg-gray-800" />
        </div>

        {/* Email + password */}
        <form onSubmit={handleEmailSignIn} className="space-y-3">
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
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-violet-500"
            />
          </div>

          {/* Case B — Google-only account */}
          {loginError?.kind === "google_only" && (
            <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3">
              <div>
                <p className="text-xs font-medium text-amber-300">
                  Sepertinya kamu daftar pakai Google.
                </p>
                <p className="mt-0.5 text-xs text-amber-400/70">
                  Akun ini tidak punya password — coba login dengan Google aja.
                </p>
              </div>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100"
              >
                <GoogleIcon className="h-4 w-4" />
                Continue with Google
              </button>
            </div>
          )}

          {/* Cases A + C — wrong credentials / not registered */}
          {loginError?.kind === "invalid_credentials" && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-400">
              Email atau password salah. Belum punya akun?{" "}
              <Link href="/signup" className="underline hover:text-red-300">
                Daftar di sini
              </Link>
            </div>
          )}

          {/* Case D — email not confirmed */}
          {loginError?.kind === "email_not_confirmed" && (
            <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-400">
              <p>Cek email kamu untuk verifikasi akun dulu ya.</p>
              {resendSuccess ? (
                <p className="text-green-400">Email verifikasi berhasil dikirim ulang!</p>
              ) : (
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={resending}
                  className="mt-1 w-full rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                >
                  {resending ? "Mengirim…" : "Kirim ulang email verifikasi"}
                </button>
              )}
            </div>
          )}

          {/* Other errors */}
          {loginError?.kind === "other" && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {loginError.message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
