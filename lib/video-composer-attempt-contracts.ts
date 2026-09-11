import type {
  CaptionStyle,
  ReelsEngine,
  ReelsVeoMode,
} from "./reels-pipeline/types";
import type { SeedanceResolution, VeoResolution } from "./reels-models";
import type { StoryboardVideoModelId } from "./video-models";
import type {
  StoryboardAspectRatio,
  StoryboardLanguageId,
  StoryboardStyleKey,
} from "./storyboard-style";

export const VIDEO_COMPOSER_DRAFT_OWNER = {
  reels: "video:reels",
  storyboardImport: "video:storyboard-import",
  storyboardVideo: "video:storyboard-to-video",
} as const;

export type ReelsPendingDraftInput = {
  theme: string;
  engine: ReelsEngine;
  veoMode: ReelsVeoMode;
  numScenes: number;
  durationPerScene: number;
  resolution: SeedanceResolution;
  veoDuration: 4 | 6 | 8;
  veoResolution: VeoResolution;
  singlePromptScenes: 1 | 2;
  veoNumScenes: number;
  voiceId: string;
  emotion: string;
  captionStyle: CaptionStyle & { highlightOnly: boolean };
  devBlank: boolean;
};

export type ReelsPendingDraft = ReelsPendingDraftInput & {
  draftOwner: typeof VIDEO_COMPOSER_DRAFT_OWNER.reels;
};

export function buildReelsPendingDraft(
  input: ReelsPendingDraftInput,
): ReelsPendingDraft {
  return {
    draftOwner: VIDEO_COMPOSER_DRAFT_OWNER.reels,
    ...input,
  };
}

export type StoryboardVideoPendingDraftInput = {
  selectedId: string;
  videoModelId: StoryboardVideoModelId;
  resolution: "480p" | "720p";
  aspectRatio: StoryboardAspectRatio;
  language: StoryboardLanguageId;
  promptDraft: string;
  devBlank: boolean;
};

export type StoryboardVideoPendingDraft = StoryboardVideoPendingDraftInput & {
  draftOwner: typeof VIDEO_COMPOSER_DRAFT_OWNER.storyboardVideo;
};

export function buildStoryboardVideoPendingDraft(
  input: StoryboardVideoPendingDraftInput,
): StoryboardVideoPendingDraft {
  return {
    draftOwner: VIDEO_COMPOSER_DRAFT_OWNER.storyboardVideo,
    ...input,
  };
}

export type StoryboardVideoAttemptInput = {
  storyboardId: string;
  videoModelId: StoryboardVideoModelId;
  resolution: "480p" | "720p";
  aspectRatio: StoryboardAspectRatio;
  language: StoryboardLanguageId;
  promptOverride: string | null;
  devBlank: boolean;
};

export function storyboardVideoAttemptSignature(
  input: StoryboardVideoAttemptInput,
): string {
  return JSON.stringify({
    storyboardId: input.storyboardId,
    videoModelId: input.videoModelId,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    language: input.language,
    promptOverride: input.promptOverride,
    devBlank: input.devBlank,
  });
}

export type StoryboardDraftValueResolution<T> =
  | { kind: "wait" }
  | { kind: "value"; value: T; consumeDraft: boolean };

export function resolveStoryboardDraftValue<T>({
  draftSelectedId,
  selectedId,
  selectedLoaded,
  draftValue,
  storedValue,
}: {
  draftSelectedId: string | null;
  selectedId: string | null;
  selectedLoaded: boolean;
  draftValue: T;
  storedValue: T;
}): StoryboardDraftValueResolution<T> {
  if (draftSelectedId && draftSelectedId === selectedId) {
    if (!selectedLoaded) return { kind: "wait" };
    return { kind: "value", value: draftValue, consumeDraft: true };
  }
  return { kind: "value", value: storedValue, consumeDraft: false };
}

export function isStoryboardVideoReady({
  loading,
  selectedLoaded,
}: {
  loading: boolean;
  selectedLoaded: boolean;
}): boolean {
  return !loading && selectedLoaded;
}

export function resolveLoadedStoryboardSelection({
  currentId,
  requestedId,
  availableIds,
}: {
  currentId: string | null;
  requestedId: string | null;
  availableIds: readonly string[];
}): string | null {
  if (currentId && availableIds.includes(currentId)) return currentId;
  if (requestedId) return null;
  return availableIds[0] ?? null;
}

export type StoryboardImportPreparationGate = {
  cancel: () => void;
  canSubmit: () => boolean;
};

export function createStoryboardImportPreparationGate(): StoryboardImportPreparationGate {
  let cancelled = false;
  return {
    cancel: () => {
      cancelled = true;
    },
    canSubmit: () => !cancelled,
  };
}

export type StoryboardImportAttemptInput = {
  imagePath: string;
  description: string;
  aspectRatio: StoryboardAspectRatio;
  language: StoryboardLanguageId;
  storyboardStyle: StoryboardStyleKey;
};

export function storyboardImportAttemptSignature(
  input: StoryboardImportAttemptInput,
): string {
  return JSON.stringify({
    imagePath: input.imagePath,
    description: input.description,
    aspectRatio: input.aspectRatio,
    language: input.language,
    storyboardStyle: input.storyboardStyle,
  });
}

export type StoryboardImportPendingDraftInput = Omit<
  StoryboardImportAttemptInput,
  "imagePath"
>;

export type StoryboardImportPendingDraft = StoryboardImportPendingDraftInput & {
  draftOwner: typeof VIDEO_COMPOSER_DRAFT_OWNER.storyboardImport;
};

export function buildStoryboardImportPendingDraft(
  input: StoryboardImportPendingDraftInput,
): StoryboardImportPendingDraft {
  return {
    draftOwner: VIDEO_COMPOSER_DRAFT_OWNER.storyboardImport,
    ...input,
  };
}
