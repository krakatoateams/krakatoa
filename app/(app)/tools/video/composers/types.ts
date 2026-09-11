import type { VideoComposerKey, VideoComposerEnablement } from "@/lib/video-composer-features";
import type {
  StoryboardAspectRatio,
  StoryboardLanguageId,
} from "@/lib/storyboard-style";
import type { VideoCreationType } from "@/lib/video-studio-deep-link";

export type { VideoCreationType };

export const CREATION_TYPES = [
  { id: "text2video", label: "Text to video", available: true },
  { id: "image2video", label: "Image to video", available: true },
  { id: "viral_template", label: "Viral Template", available: true },
  { id: "motion_control", label: "Motion control", available: true },
  { id: "storyboard", label: "Storyboard to video", available: true },
  { id: "reels-creator", label: "Reels Creator", available: false },
] as const;

export type VideoCreationTypeOption = (typeof CREATION_TYPES)[number];

export function composerKeyForCreationType(id: VideoCreationType): VideoComposerKey {
  return id as VideoComposerKey;
}

/** Select exactly one composer factory so inactive modes stay unmounted. */
export function selectActiveVideoComposer<T>(
  activeType: VideoCreationType,
  composers: Readonly<Record<VideoCreationType, T>>
): T {
  return composers[activeType];
}

export type CharacterSource = "upload" | "library";
export type LibraryCharacter = { id: string; url: string; title: string };

export type StoryboardListItem = {
  id: string;
  storyboardUrl: string;
  theme: string;
  hasVideo: boolean;
  aspectRatio: StoryboardAspectRatio | null;
  language: StoryboardLanguageId | null;
  seedancePrompt: string;
  source: string | null;
};

export type VideoComposerShellProps = {
  creationTypes: VideoCreationTypeOption[];
  isAdmin: boolean;
  devBlank: boolean;
  onDevBlankChange: (next: boolean) => void;
  composerEnablement: Record<VideoComposerKey, VideoComposerEnablement> | null;
  onSelectCreation: (id: string) => void;
  onGenerated: () => void;
};
