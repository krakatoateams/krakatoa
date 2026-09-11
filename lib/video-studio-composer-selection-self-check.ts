import {
  selectActiveVideoComposer,
  type VideoCreationType,
} from "../app/(app)/tools/video/composers/types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`video-studio composer selection: ${message}`);
  }
}

const TYPES: VideoCreationType[] = [
  "text2video",
  "image2video",
  "viral_template",
  "motion_control",
  "storyboard",
  "reels-creator",
];

export function videoStudioComposerSelectionSelfCheck(): void {
  for (const activeType of TYPES) {
    const mounted: VideoCreationType[] = [];
    const factories = Object.fromEntries(
      TYPES.map((type) => [type, () => mounted.push(type)])
    ) as Record<VideoCreationType, () => number>;

    selectActiveVideoComposer(activeType, factories)();

    assert(
      mounted.length === 1 && mounted[0] === activeType,
      `${activeType} must be the only mounted composer`
    );
  }
}

videoStudioComposerSelectionSelfCheck();
console.log("video-studio composer selection self-check passed");
