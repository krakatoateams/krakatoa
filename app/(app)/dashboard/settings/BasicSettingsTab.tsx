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
          <h2 className="text-lg font-semibold text-white">Basic settings</h2>
          <p className="mt-1 text-sm text-gray-500">
            Your profile details. Editing is coming soon.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-gray-700 bg-gray-800 px-3 py-1 text-xs font-medium text-gray-500">
          Coming soon
        </span>
      </header>

      <div className="space-y-5 rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-400">
            Display name
          </label>
          <input
            type="text"
            value={user?.name ?? ""}
            disabled
            readOnly
            className="w-full cursor-not-allowed rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-400"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-400">
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
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/20 text-sm font-semibold text-violet-300">
                {user?.name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm font-medium text-gray-500"
            >
              Change avatar
            </button>
          </div>
        </div>

        <p className="text-xs text-gray-600">
          These fields currently mirror your Google account and cannot be edited
          yet.
        </p>
      </div>
    </div>
  );
}
