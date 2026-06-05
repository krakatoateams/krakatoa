"use client";

import { useSession } from "next-auth/react";
import { Video, Camera, Music2, Check } from "lucide-react";

function ConnectionRow({
  icon,
  name,
  description,
  status,
}: {
  icon: React.ReactNode;
  name: string;
  description: string;
  status: "connected" | "soon";
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-gray-300">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">{name}</p>
          <p className="truncate text-xs text-gray-500">{description}</p>
        </div>
      </div>
      {status === "connected" ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
          <Check className="h-3.5 w-3.5" />
          Connected
        </span>
      ) : (
        <span className="shrink-0 rounded-full border border-gray-700 bg-gray-800 px-3 py-1 text-xs font-medium text-gray-500">
          Coming soon
        </span>
      )}
    </div>
  );
}

export default function ConnectionsTab() {
  const { status } = useSession();
  const youtubeConnected = status === "authenticated";

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-white">Connections</h2>
        <p className="mt-1 text-sm text-gray-500">
          Social platforms used for publishing. YouTube publishing is enabled
          through your Google sign-in.
        </p>
      </header>

      <div className="divide-y divide-gray-800 rounded-xl border border-gray-800 bg-gray-900">
        <ConnectionRow
          icon={<Video className="h-5 w-5 text-red-400" />}
          name="YouTube"
          description={
            youtubeConnected
              ? "Signed in with Google — YouTube publishing enabled"
              : "Sign in with Google to enable YouTube publishing"
          }
          status={youtubeConnected ? "connected" : "soon"}
        />
        <ConnectionRow
          icon={<Camera className="h-5 w-5" />}
          name="Instagram"
          description="Auto-publish Reels to Instagram"
          status="soon"
        />
        <ConnectionRow
          icon={<Music2 className="h-5 w-5" />}
          name="TikTok"
          description="Auto-publish videos to TikTok"
          status="soon"
        />
      </div>

      <p className="text-xs text-gray-600">
        YouTube access is tied to your Google sign-in, so there is no separate
        disconnect here. Independent per-platform connections are coming soon.
      </p>
    </div>
  );
}
