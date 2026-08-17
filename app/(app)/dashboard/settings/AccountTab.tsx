"use client";

import Image from "next/image";
import { useCurrentUser } from "@/lib/auth-context";
import { getSupabaseAuthBrowser } from "@/lib/supabase-browser-auth";
import { LogOut } from "lucide-react";

export default function AccountTab() {
  const { status, user, name, email, image } = useCurrentUser();

  if (status === "loading") {
    return <div className="h-40 animate-pulse rounded-xl bg-white/5" />;
  }

  const displayUser = { name, email, image };
  const isGoogleUser = user?.app_metadata?.provider === "google";

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-N900">Account</h2>
        <p className="mt-1 text-sm text-text-disabled">
          Your identity and session details.
        </p>
      </header>

      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
        <div className="flex items-center gap-4">
          {displayUser?.image ? (
            <Image
              src={image!}
              alt={name ?? "Profile"}
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 rounded-full"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg font-semibold text-N700">
              {displayUser?.name?.[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-N900">
              {displayUser?.name ?? "Unknown user"}
            </p>
            <p className="truncate text-sm text-text-disabled">{displayUser?.email}</p>
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-text-secondary">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {isGoogleUser ? "Signed in with Google" : "Signed in with email"}
            </span>
          </div>
        </div>

        <div className="mt-6 border-t border-white/10 pt-5">
          <button
            type="button"
            onClick={() => getSupabaseAuthBrowser().auth.signOut().then(() => { window.location.href = "/dashboard"; })}
            className="inline-flex cursor-pointer items-center gap-2 rounded-radius-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-N700 transition-colors hover:border-error/50 hover:bg-error/10 hover:text-error"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
