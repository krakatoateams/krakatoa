import {
  buildReelsPendingDraft,
  buildStoryboardImportPendingDraft,
  buildStoryboardVideoPendingDraft,
  createStoryboardImportPreparationGate,
  isStoryboardVideoReady,
  resolveLoadedStoryboardSelection,
  resolveStoryboardDraftValue,
  storyboardImportAttemptSignature,
  storyboardVideoAttemptSignature,
} from "./video-composer-attempt-contracts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`video-composer attempt contracts: ${msg}`);
}

export function videoComposerAttemptContractsSelfCheck(): void {
  const captionStyle = {
    fontname: "Poppins",
    fontsize: 60,
    primaryColor: "#FFFFFF",
    highlightColor: "#FFFF00",
    outlineColor: "#000000",
    outlineThickness: 4,
    marginV: 15,
    highlightOnly: true,
  };
  const reelsDraft = buildReelsPendingDraft({
    theme: "A moon landing",
    engine: "veo",
    veoMode: "perScene",
    numScenes: 2,
    durationPerScene: 10,
    resolution: "720p",
    veoDuration: 8,
    veoResolution: "1080p",
    singlePromptScenes: 2,
    veoNumScenes: 3,
    voiceId: "English_WiseScholar",
    emotion: "calm",
    captionStyle,
    devBlank: true,
  });

  assert(reelsDraft.draftOwner === "video:reels", "Reels draft must be owner-scoped");
  assert(reelsDraft.voiceId === "English_WiseScholar", "Reels draft must preserve voice");
  assert(reelsDraft.emotion === "calm", "Reels draft must preserve emotion");
  assert(reelsDraft.captionStyle === captionStyle, "Reels draft must preserve caption style");
  assert(reelsDraft.singlePromptScenes === 2, "Reels draft must preserve single prompt scenes");
  assert(reelsDraft.veoNumScenes === 3, "Reels draft must preserve per-scene count");
  assert(reelsDraft.devBlank === true, "Reels draft must preserve dev-blank mode");

  const storyboardDraft = buildStoryboardVideoPendingDraft({
    selectedId: "storyboard-1",
    videoModelId: "seedance2_fast",
    resolution: "720p",
    aspectRatio: "9:16",
    language: "indonesian",
    promptDraft: "A revised six-panel sequence",
    devBlank: true,
  });
  assert(
    storyboardDraft.draftOwner === "video:storyboard-to-video",
    "Storyboard video draft must be owner-scoped",
  );
  assert(storyboardDraft.selectedId === "storyboard-1", "Storyboard selection must survive sign-in");
  assert(
    storyboardDraft.promptDraft === "A revised six-panel sequence",
    "Storyboard prompt override must survive sign-in",
  );
  assert(
    !isStoryboardVideoReady({ loading: false, selectedLoaded: false }),
    "Generate must wait for the restored storyboard before sending its prompt",
  );
  assert(
    isStoryboardVideoReady({ loading: false, selectedLoaded: true }),
    "Generate may proceed once the selected storyboard is loaded",
  );
  assert(
    resolveLoadedStoryboardSelection({
      currentId: "foreign-or-deleted",
      requestedId: "foreign-or-deleted",
      availableIds: ["owned-1", "owned-2"],
    }) === null,
    "a missing deep-linked storyboard must not silently select another storyboard",
  );
  assert(
    resolveLoadedStoryboardSelection({
      currentId: null,
      requestedId: null,
      availableIds: ["owned-1", "owned-2"],
    }) === "owned-1",
    "the normal non-deep-linked view may select the first owned storyboard",
  );

  const normalSignature = storyboardVideoAttemptSignature({
    storyboardId: "storyboard-1",
    videoModelId: "seedance2_fast",
    resolution: "720p",
    aspectRatio: "9:16",
    language: "indonesian",
    promptOverride: "A revised six-panel sequence",
    devBlank: false,
  });
  const devBlankSignature = storyboardVideoAttemptSignature({
    storyboardId: "storyboard-1",
    videoModelId: "seedance2_fast",
    resolution: "720p",
    aspectRatio: "9:16",
    language: "indonesian",
    promptOverride: "A revised six-panel sequence",
    devBlank: true,
  });
  assert(
    normalSignature !== devBlankSignature,
    "dev-blank must rotate the Storyboard video idempotency signature",
  );

  const waitingPrompt = resolveStoryboardDraftValue({
    draftSelectedId: "storyboard-1",
    selectedId: "storyboard-1",
    selectedLoaded: false,
    draftValue: "Restored prompt",
    storedValue: "",
  });
  assert(waitingPrompt.kind === "wait", "draft sync must wait for the selected storyboard to load");

  const restoredPrompt = resolveStoryboardDraftValue({
    draftSelectedId: "storyboard-1",
    selectedId: "storyboard-1",
    selectedLoaded: true,
    draftValue: "Restored prompt",
    storedValue: "Stored prompt",
  });
  assert(
    restoredPrompt.kind === "value" &&
      restoredPrompt.value === "Restored prompt" &&
      restoredPrompt.consumeDraft,
    "loaded selection must preserve the pending prompt override",
  );

  const importInput = {
    imagePath: "user-1/videos/temp/refs/storyboard.png",
    description: "A chase through the city",
    aspectRatio: "9:16" as const,
    language: "indonesian" as const,
    storyboardStyle: "cinematic_sketch" as const,
  };
  const importSignature = storyboardImportAttemptSignature(importInput);
  assert(
    storyboardImportAttemptSignature({ ...importInput }) === importSignature,
    "an identical storyboard import retry must keep the same signature",
  );
  assert(
    storyboardImportAttemptSignature({
      ...importInput,
      imagePath: "user-1/videos/temp/refs/other.png",
    }) !== importSignature,
    "a different uploaded image path must rotate the import signature",
  );

  const importDraft = buildStoryboardImportPendingDraft({
    description: importInput.description,
    aspectRatio: importInput.aspectRatio,
    language: importInput.language,
    storyboardStyle: importInput.storyboardStyle,
  });
  assert(
    importDraft.draftOwner === "video:storyboard-import",
    "Storyboard import draft must be owner-scoped on the shared video pathname",
  );

  const preparation = createStoryboardImportPreparationGate();
  assert(preparation.canSubmit(), "a new storyboard upload may continue to Analyze");
  preparation.cancel();
  assert(
    !preparation.canSubmit(),
    "cancelling during upload must prevent the later Analyze submission",
  );
}

videoComposerAttemptContractsSelfCheck();
console.log("video-composer attempt contracts self-check passed");
