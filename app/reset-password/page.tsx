"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseAuthBrowser } from "@/lib/supabase-browser-auth";
import { AuthLayout } from "@/components/auth/AuthLayout";

type SessionState = "checking" | "valid" | "invalid";

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
      setError("Password dan konfirmasi password tidak sama.");
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
        <div className="py-8 text-center text-sm text-gray-400">Memeriksa link…</div>
      </AuthLayout>
    );
  }

  if (sessionState === "invalid") {
    return (
      <AuthLayout>
        <div className="space-y-4 text-center">
          <h1 className="font-display text-xl font-bold text-white">Link tidak valid</h1>
          <p className="text-sm text-gray-400">
            Link ini tidak valid atau sudah kedaluwarsa.
          </p>
          <Link
            href="/forgot-password"
            className="block text-sm text-[#F26522] hover:text-[#e05a1a]"
          >
            Minta link reset password baru
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-xl font-bold text-white">Buat password baru</h1>
          <p className="mt-1 text-sm text-gray-400">
            Masukkan password baru kamu di bawah ini.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              Password baru
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-[#F26522]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              Konfirmasi password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-[#F26522]"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-[#F26522] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#e05a1a] disabled:opacity-50"
          >
            {loading ? "Menyimpan…" : "Simpan password baru"}
          </button>
        </form>
      </div>
    </AuthLayout>
  );
}
