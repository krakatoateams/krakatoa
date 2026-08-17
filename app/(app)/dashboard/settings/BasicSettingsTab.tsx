"use client";

import Image from "next/image";
import { useCurrentUser } from "@/lib/auth-context";

export default function BasicSettingsTab() {
  const { name, image } = useCurrentUser();
  const user = { name, image };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-N900">Basic settings</h2>
          <p className="mt-1 text-sm text-text-disabled">
            Your profile details. Editing is coming soon.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-medium text-text-disabled">
          Coming soon
        </span>
      </header>

      <div className="space-y-5 rounded-xl border border-white/10 bg-white/[0.04] p-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-secondary">
            Display name
          </label>
          <input
            type="text"
            value={user?.name ?? ""}
            disabled
            readOnly
            className="w-full cursor-not-allowed rounded-radius-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-text-secondary"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-secondary">
            Avatar
          </label>
          <div className="flex items-center gap-3">
            {user?.image ? (
              <Image
                src={user.image}
                alt={user.name ?? "Avatar"}
                width={48}
                height={48}
                className="h-12 w-12 rounded-full opacity-70"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-N700">
                {user?.name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-radius-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm font-medium text-text-disabled"
            >
              Change avatar
            </button>
          </div>
        </div>

        <p className="text-xs text-text-disabled">
          These fields currently mirror your Google account and cannot be edited
          yet.
        </p>
      </div>
    </div>
  );
}
