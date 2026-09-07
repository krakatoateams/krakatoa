"use client";

import { AlertCircle, UserRound } from "lucide-react";
import PhotoLibraryPicker from "@/components/PhotoLibraryPicker";
import type { RefGroupApi } from "@/components/studio";
import type { CreationHistoryItem } from "@/lib/creations";
import { parseMentionAssetsFromHistory, type MentionAsset } from "@/lib/mention-assets";
import { MOTION_CONTROL_CHARACTER_HINT } from "@/lib/motion-control-models";
import type { ChipOption } from "@/components/studio";
import type { VideoAspectRatio } from "@/lib/video-models";
import type { CharacterSource, LibraryCharacter, VideoCreationTypeOption } from "./types";

export function GenerationRecoverableBanner({
  message,
  loading,
  onResume,
}: {
  message: string;
  loading: boolean;
  onResume: () => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <span>{message}</span>
      </div>
      <button
        type="button"
        onClick={onResume}
        disabled={loading}
        className="rounded-xl bg-warning px-4 py-2 font-medium text-static-black transition hover:brightness-110 disabled:opacity-50"
      >
        Try again
      </button>
    </div>
  );
}

export async function loadMentionAssetsFromApi(): Promise<MentionAsset[]> {
  try {
    const res = await fetch(
      "/api/creations/history?tool=product_photo,storyboard&mediaType=image&limit=50"
    );
    const data = await res.json();
    return parseMentionAssetsFromHistory((data.items ?? []) as CreationHistoryItem[]);
  } catch {
    return [];
  }
}

/** Reels Creator is admin-only until public launch; other types use `available`. */
export function isVideoCreationUsable(c: VideoCreationTypeOption, isAdmin: boolean): boolean {
  if (c.id === "reels-creator") return isAdmin;
  return c.available;
}

export function creationTypeChipOptions(
  types: readonly VideoCreationTypeOption[],
  isAdmin: boolean
): ChipOption[] {
  return types.map((c) => ({
    id: c.id,
    label: c.label,
    hint: isVideoCreationUsable(c, isAdmin) ? undefined : "Soon",
  }));
}

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
export const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm";
export const AUDIO_ACCEPT = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/webm";
export const MC_IMAGE_ACCEPT = "image/jpeg,image/png";
export const MC_VIDEO_ACCEPT = "video/mp4,video/quicktime";

export const ASPECT_RATIO_LABELS: Record<VideoAspectRatio, string> = {
  "16:9": "16:9",
  "4:3": "4:3",
  "1:1": "1:1",
  "3:4": "3:4",
  "9:16": "9:16",
  "21:9": "21:9",
  "9:21": "9:21",
  adaptive: "Adaptive",
};

// Motion Control "Your character" — upload or pick a saved Photo Studio image
// (character turnaround sheets are excluded; they're grids, not a source photo).
export function CharacterPicker({
  group,
  source,
  onSourceChange,
  selected,
  onSelect,
  disabled,
}: {
  group: RefGroupApi;
  source: CharacterSource;
  onSourceChange: (s: CharacterSource) => void;
  selected: LibraryCharacter | null;
  onSelect: (c: LibraryCharacter | null) => void;
  disabled?: boolean;
}) {
  return (
    <PhotoLibraryPicker
      label="Your character"
      icon={<UserRound className="h-3.5 w-3.5" />}
      accept={MC_IMAGE_ACCEPT}
      group={group}
      source={source}
      onSourceChange={onSourceChange}
      selected={selected}
      onSelect={onSelect}
      disabled={disabled}
      hint={MOTION_CONTROL_CHARACTER_HINT}
    />
  );
}
