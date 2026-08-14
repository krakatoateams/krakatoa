"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCurrentUser } from "@/lib/auth-context";
import { Video, Camera, Music2, Check, X } from "lucide-react";

export default function ConnectionsTab() {
  const { status: authStatus } = useCurrentUser();
  const searchParams = useSearchParams();

  const [youtubeConnected, setYoutubeConnected] = useState<boolean | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const [tiktokConnected, setTiktokConnected] = useState<boolean | null>(null);
  const [disconnectingTiktok, setDisconnectingTiktok] = useState(false);
  const [confirmDisconnectTiktok, setConfirmDisconnectTiktok] = useState(false);

  const [instagramConnected, setInstagramConnected] = useState<boolean | null>(null);
  const [disconnectingInstagram, setDisconnectingInstagram] = useState(false);
  const [confirmDisconnectInstagram, setConfirmDisconnectInstagram] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Surface redirect-back errors from the OAuth callback.
  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError === "youtube_connect_failed") {
      setError("Couldn't connect YouTube. Please try again.");
    } else if (urlError === "tiktok_connect_failed") {
      setError("Couldn't connect TikTok. Please try again.");
    } else if (urlError === "instagram_connect_failed") {
      setError("Couldn't connect Instagram. Please try again.");
    } else if (urlError === "instagram_not_business_account") {
      setError(
        "This Instagram account isn't set up for publishing yet — convert it to a Business or Creator account in Instagram's settings, then try connecting again.",
      );
    } else if (urlError === "invalid_state") {
      setError("Connection attempt expired or was tampered with. Please try again.");
    }
  }, [searchParams]);

  useEffect(() => {
    if (authStatus === "loading") return;
    if (authStatus === "unauthenticated") {
      setYoutubeConnected(false);
      setTiktokConnected(false);
      setInstagramConnected(false);
      return;
    }
    fetch("/api/connections/status")
      .then((res) => (res.ok ? res.json() : { youtube: false, tiktok: false, instagram: false }))
      .then((data: { youtube?: boolean; tiktok?: boolean; instagram?: boolean }) => {
        setYoutubeConnected(Boolean(data.youtube));
        setTiktokConnected(Boolean(data.tiktok));
        setInstagramConnected(Boolean(data.instagram));
      })
      .catch(() => {
        setYoutubeConnected(false);
        setTiktokConnected(false);
        setInstagramConnected(false);
      });
  }, [authStatus]);

  async function handleDisconnect() {
    setDisconnecting(true);
    setConfirmDisconnect(false);
    try {
      const res = await fetch("/api/connections/youtube", { method: "DELETE" });
      if (res.ok) {
        setYoutubeConnected(false);
      } else {
        setError("Couldn't disconnect YouTube. Please try again.");
      }
    } catch {
      setError("Couldn't disconnect YouTube. Please try again.");
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleDisconnectTiktok() {
    setDisconnectingTiktok(true);
    setConfirmDisconnectTiktok(false);
    try {
      const res = await fetch("/api/connections/tiktok", { method: "DELETE" });
      if (res.ok) {
        setTiktokConnected(false);
      } else {
        setError("Couldn't disconnect TikTok. Please try again.");
      }
    } catch {
      setError("Couldn't disconnect TikTok. Please try again.");
    } finally {
      setDisconnectingTiktok(false);
    }
  }

  async function handleDisconnectInstagram() {
    setDisconnectingInstagram(true);
    setConfirmDisconnectInstagram(false);
    try {
      const res = await fetch("/api/connections/instagram", { method: "DELETE" });
      if (res.ok) {
        setInstagramConnected(false);
      } else {
        setError("Couldn't disconnect Instagram. Please try again.");
      }
    } catch {
      setError("Couldn't disconnect Instagram. Please try again.");
    } finally {
      setDisconnectingInstagram(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-white">Connections</h2>
        <p className="mt-1 text-sm text-gray-500">
          Social platforms used for publishing.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="mt-0.5 shrink-0 text-red-400/60 hover:text-red-400"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="divide-y divide-gray-800 rounded-xl border border-gray-800 bg-gray-900">
        {/* YouTube row — interactive */}
        {youtubeConnected === null ? (
          <div className="px-5 py-4">
            <div className="h-10 animate-pulse rounded-lg bg-gray-800" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-800">
                <Video className="h-5 w-5 text-red-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">YouTube</p>
                <p className="truncate text-xs text-gray-500">
                  {youtubeConnected
                    ? "YouTube publishing enabled"
                    : "YouTube publishing not yet connected"}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {youtubeConnected ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
                    <Check className="h-3.5 w-3.5" />
                    Connected
                  </span>
                  {confirmDisconnect ? (
                    <>
                      <button
                        type="button"
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                        className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {disconnecting ? "Disconnecting…" : "Confirm"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDisconnect(false)}
                        disabled={disconnecting}
                        className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1 text-xs font-medium text-gray-400 transition-colors hover:text-white disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnect(true)}
                      className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1 text-xs font-medium text-gray-400 transition-colors hover:border-red-500/40 hover:text-red-400"
                    >
                      Disconnect
                    </button>
                  )}
                </>
              ) : (
                <a
                  href="/api/connections/youtube/start"
                  className="rounded-lg border border-[#F26522]/40 bg-[#F26522]/10 px-3 py-1 text-xs font-medium text-[#F26522] transition-colors hover:bg-[#F26522]/20"
                >
                  Connect
                </a>
              )}
            </div>
          </div>
        )}

        {/* Instagram row — interactive */}
        {instagramConnected === null ? (
          <div className="px-5 py-4">
            <div className="h-10 animate-pulse rounded-lg bg-gray-800" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-800">
                <Camera className="h-5 w-5 text-pink-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">Instagram</p>
                <p className="truncate text-xs text-gray-500">
                  {instagramConnected
                    ? "Instagram publishing enabled"
                    : "Instagram publishing not yet connected"}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {instagramConnected ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
                    <Check className="h-3.5 w-3.5" />
                    Connected
                  </span>
                  {confirmDisconnectInstagram ? (
                    <>
                      <button
                        type="button"
                        onClick={handleDisconnectInstagram}
                        disabled={disconnectingInstagram}
                        className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {disconnectingInstagram ? "Disconnecting…" : "Confirm"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDisconnectInstagram(false)}
                        disabled={disconnectingInstagram}
                        className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1 text-xs font-medium text-gray-400 transition-colors hover:text-white disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnectInstagram(true)}
                      className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1 text-xs font-medium text-gray-400 transition-colors hover:border-red-500/40 hover:text-red-400"
                    >
                      Disconnect
                    </button>
                  )}
                </>
              ) : (
                <a
                  href="/api/connections/instagram/start"
                  className="rounded-lg border border-[#F26522]/40 bg-[#F26522]/10 px-3 py-1 text-xs font-medium text-[#F26522] transition-colors hover:bg-[#F26522]/20"
                >
                  Connect
                </a>
              )}
            </div>
          </div>
        )}

        {/* TikTok row — interactive */}
        {tiktokConnected === null ? (
          <div className="px-5 py-4">
            <div className="h-10 animate-pulse rounded-lg bg-gray-800" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-800">
                <Music2 className="h-5 w-5 text-pink-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">TikTok</p>
                <p className="truncate text-xs text-gray-500">
                  {tiktokConnected
                    ? "TikTok publishing enabled"
                    : "TikTok publishing not yet connected"}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {tiktokConnected ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
                    <Check className="h-3.5 w-3.5" />
                    Connected
                  </span>
                  {confirmDisconnectTiktok ? (
                    <>
                      <button
                        type="button"
                        onClick={handleDisconnectTiktok}
                        disabled={disconnectingTiktok}
                        className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {disconnectingTiktok ? "Disconnecting…" : "Confirm"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDisconnectTiktok(false)}
                        disabled={disconnectingTiktok}
                        className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1 text-xs font-medium text-gray-400 transition-colors hover:text-white disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDisconnectTiktok(true)}
                      className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1 text-xs font-medium text-gray-400 transition-colors hover:border-red-500/40 hover:text-red-400"
                    >
                      Disconnect
                    </button>
                  )}
                </>
              ) : (
                <a
                  href="/api/connections/tiktok/start"
                  className="rounded-lg border border-[#F26522]/40 bg-[#F26522]/10 px-3 py-1 text-xs font-medium text-[#F26522] transition-colors hover:bg-[#F26522]/20"
                >
                  Connect
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
