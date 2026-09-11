"use client";

import { useEffect, useState } from "react";
import type { MentionAsset } from "@/lib/mention-assets";
import {
  AlertCircle,
  Clock,
  Cpu,
  Crop,
  Film,
  ImageIcon,
  Layers,
  Loader2,
  Maximize2,
  Music,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import MentionTextarea from "@/components/MentionTextarea";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { usePricing } from "@/app/(app)/pricing-context";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { consumePendingDraft } from "@/lib/pending-form-draft";
import { useStudioGenerationSubmit } from "@/lib/studio-generation-submit";
import { STUDIO_GENERATION_RECOVERABLE_FALLBACK } from "@/lib/studio-generation-response";
import {
  ChipDropdown,
  CreditActionButton,
  GENERATE_BTN_CLASS,
  GenerationCancelButton,
  DevBlankTestToggle,
  Tooltip,
  RefGroup,
  RefMediaGroup,
  useMediaRefs,
  STUDIO_CHIP_ROW_CLASS,
  StudioForm,
  StudioFormCard,
  StudioFormHeader,
  StudioModelPanel,
  useStudioGenerationPreview,
} from "@/components/studio";
import {
  TEXT_TO_VIDEO_MODELS,
  DEFAULT_VIDEO_MODEL_ID,
  getVideoModel,
  getAllowedDurations,
  validateVideoReferences,
  allowsFrameWithReferenceImages,
  formatVideoModelCreditHint,
  type VideoModelId,
  type VideoResolution,
  type VideoAspectRatio,
} from "@/lib/video-models";
import {
  filterEnabledCatalog,
  snapToEnabledModel,
  type VideoComposerKey,
  type VideoComposerEnablement,
} from "@/lib/video-composer-features";
import {
  ASPECT_RATIO_LABELS,
  AUDIO_ACCEPT,
  creationTypeChipOptions,
  GenerationRecoverableBanner,
  IMAGE_ACCEPT,
  VIDEO_ACCEPT,
} from "./shared";
import { CREATION_TYPES, type VideoCreationTypeOption } from "./types";

export default function TextToVideoComposer({
  initialPrompt,
  mentionAssets,
  creationTypes,
  isAdmin,
  devBlank,
  onDevBlankChange,
  composerEnablement,
  onSelectCreation,
  onGenerated,
}: {
  initialPrompt: string | null;
  mentionAssets: MentionAsset[];
  creationTypes: VideoCreationTypeOption[];
  isAdmin: boolean;
  devBlank: boolean;
  onDevBlankChange: (next: boolean) => void;
  composerEnablement: Record<VideoComposerKey, VideoComposerEnablement> | null;
  onSelectCreation: (id: string) => void;
  onGenerated: () => void;
}) {
  const { openPreviewFromResponse } = useStudioGenerationPreview();
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const { balance, refetch: refetchCredits } = useCreditBalance();

  const text2videoModels = filterEnabledCatalog(
    TEXT_TO_VIDEO_MODELS,
    "text2video",
    composerEnablement
  );

  const [modelId, setModelId] = useState<VideoModelId>(DEFAULT_VIDEO_MODEL_ID);
  const model = getVideoModel(modelId);

  useEffect(() => {
    if (text2videoModels.length === 0) return;
    const next = snapToEnabledModel(
      modelId,
      text2videoModels,
      "text2video",
      composerEnablement
    ) as VideoModelId;
    if (next !== modelId) setModelId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text2videoModels.map((m) => m.id).join(","), composerEnablement]);

  const supportsMentions =
    model.references.referenceImages > 0 || model.references.firstFrame;

  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [mentions, setMentions] = useState<MentionAsset[]>([]);
  const [duration, setDuration] = useState<number>(model.defaultDuration);
  const [resolution, setResolution] = useState<VideoResolution>(model.defaultResolution);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>(model.defaultAspectRatio);
  const [generateAudio, setGenerateAudio] = useState<boolean>(model.defaultGenerateAudio);

  // When the model changes, keep the parameters valid for the newly-selected model
  // (e.g. switching away from Seedance 2 — which supports 1080p — back to the Fast
  // variant must drop 1080p down to a supported resolution).
  useEffect(() => {
    const m = getVideoModel(modelId);
    setResolution((r) => (m.resolutions.includes(r) ? r : m.defaultResolution));
    setAspectRatio((a) => (m.aspectRatios.includes(a) ? a : m.defaultAspectRatio));
    if (!m.supportsAudio) setGenerateAudio(false);
  }, [modelId]);

  // Restore what was typed before a gated Generate click sent the visitor
  // through sign-in — see lib/pending-form-draft.ts.
  useEffect(() => {
    const draft = consumePendingDraft<{
      prompt?: string;
      duration?: number;
      resolution?: VideoResolution;
      aspectRatio?: VideoAspectRatio;
    }>(window.location.pathname);
    if (!draft) return;
    if (draft.prompt) setPrompt(draft.prompt);
    if (draft.duration) setDuration(draft.duration);
    if (draft.resolution) setResolution(draft.resolution);
    if (draft.aspectRatio) setAspectRatio(draft.aspectRatio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep duration valid for the current model + resolution. Some models restrict
  // durations at certain resolutions (e.g. Veo 3.1 Lite only allows 8s at 1080p).
  useEffect(() => {
    const m = getVideoModel(modelId);
    const allowed = getAllowedDurations(m, resolution);
    setDuration((d) =>
      allowed.includes(d)
        ? d
        : allowed.includes(m.defaultDuration)
          ? m.defaultDuration
          : allowed[allowed.length - 1]
    );
  }, [modelId, resolution]);

  const {
    loading,
    error,
    recoverableJobId,
    submit,
    resumeRecoverable,
    cancel: cancelSubmit,
    cancelling,
    cancelAllowed,
  } = useStudioGenerationSubmit({
    idempotencyScope: "video:text-to-video",
    refetchCredits,
    refreshHistory: onGenerated,
    openPreviewFromResponse,
  });

  const { videoCredits } = usePricing();

  // Reference groups.
  const firstFrame = useMediaRefs("image", 1);
  const lastFrame = useMediaRefs("image", 1);
  const refImages = useMediaRefs("image", model.references.referenceImages);
  const refVideos = useMediaRefs("video", model.references.referenceVideos);
  const refAudios = useMediaRefs("audio", model.references.referenceAudios);

  // Drop any references the newly-selected model can't accept (e.g. switching to
  // Veo 3.1 Fast, which only supports first/last frame — no reference arrays).
  useEffect(() => {
    const caps = getVideoModel(modelId).references;
    if (!caps.firstFrame) firstFrame.reset();
    if (!caps.lastFrame) lastFrame.reset();
    if (caps.referenceImages === 0) refImages.reset();
    if (caps.referenceVideos === 0) refVideos.reset();
    if (caps.referenceAudios === 0) refAudios.reset();
    setMentions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  // Mutual-exclusion gating (mirrors validateVideoReferences).
  const hasFrames = firstFrame.items.length > 0 || lastFrame.items.length > 0;
  const hasRefImages = refImages.items.length > 0;
  const firstFrameReady = firstFrame.done.length > 0;
  const hasRefImageOrVideo = refImages.done.length > 0 || refVideos.done.length > 0;
  const refImagesBlocked1080p =
    model.providerFamily === "seedance1lite" && resolution === "1080p";
  const resolution1080pBlockedByRefs =
    model.providerFamily === "seedance1lite" && hasRefImages;
  const refVideoBlocked4k =
    model.providerFamily === "kling3omni" && resolution === "4k";
  const audioBlockedByRefVideo =
    model.providerFamily === "kling3omni" && refVideos.done.length > 0;
  // Kling v1.6 allows start_image + reference_images together.
  const blocksFramesWithRefs = !allowsFrameWithReferenceImages(model.providerFamily);

  useEffect(() => {
    if (resolution1080pBlockedByRefs && resolution === "1080p") {
      setResolution("720p");
    }
  }, [resolution1080pBlockedByRefs, resolution]);

  useEffect(() => {
    if (refVideoBlocked4k && refVideos.done.length > 0) {
      refVideos.reset();
    }
  }, [refVideoBlocked4k, refVideos]);

  useEffect(() => {
    if (audioBlockedByRefVideo && generateAudio) {
      setGenerateAudio(false);
    }
  }, [audioBlockedByRefVideo, generateAudio]);

  const anyUploading =
    firstFrame.uploading ||
    lastFrame.uploading ||
    refImages.uploading ||
    refVideos.uploading ||
    refAudios.uploading;

  // A reference video bumps Seedance to its pricier "video_in" tier — keep the
  // cost label aligned with what the server will actually bill.
  const hasReferenceVideo = refVideos.done.length > 0;
  const pricingKey = model.pricingKey({ resolution, hasReferenceVideo, generateAudio });
  const videoCost = devBlank ? 0 : videoCredits(pricingKey, duration);

  const referenceInputs = {
    firstFrame: firstFrame.done[0]?.url ?? null,
    lastFrame: lastFrame.done[0]?.url ?? null,
    referenceImages: refImages.done.map((r) => r.url),
    referenceVideos: refVideos.done.map((r) => r.url),
    referenceAudios: refAudios.done.map((r) => r.url),
  };
  const refCheck = validateVideoReferences(model, referenceInputs, {
    resolution,
    generateAudio,
  });

  const canGenerate =
    !loading && !anyUploading && prompt.trim().length > 0 && refCheck.ok;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate) return;
    if (status !== "authenticated") {
      openSignInModal(undefined, { prompt, duration, resolution, aspectRatio });
      return;
    }

    const toRef = (items: { url: string; path: string }[]) =>
      items.map((r) => ({ url: r.url, path: r.path }));

    const body = {
      modelId,
      prompt: prompt.trim(),
      duration,
      resolution,
      aspectRatio,
      generateAudio,
      referenceCreationIds: mentions.map((m) => m.id),
      references: {
        firstFrame: firstFrame.done[0] ?? null,
        lastFrame: lastFrame.done[0] ?? null,
        referenceImages: toRef(refImages.done),
        referenceVideos: toRef(refVideos.done),
        referenceAudios: toRef(refAudios.done),
      },
      ...(devBlank ? { devBlank: true } : {}),
    };

    await submit(JSON.stringify(body), (idempotencyKey) =>
      fetch("/api/generate-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      }),
      {
        fallbackCost: videoCost,
        onSuccess: () => {
          firstFrame.reset();
          lastFrame.reset();
          refImages.reset();
          refVideos.reset();
          refAudios.reset();
          setMentions([]);
        },
      },
    );
  };

  const selectedCreation = CREATION_TYPES.find((c) => c.id === "text2video");

  // Reference-images uploader now lives inline beside the prompt (desktop) and
  // above it (mobile), so its gating is shared by both placements.
  const refImagesDisabled =
    loading || (blocksFramesWithRefs && hasFrames) || refImagesBlocked1080p;
  const refImagesDisabledReason =
    blocksFramesWithRefs && hasFrames
      ? "Remove first/last frame to use reference images."
      : refImagesBlocked1080p
        ? "Reference images are only supported at 480p or 720p."
        : undefined;
  const refImagesHint =
    blocksFramesWithRefs && hasFrames
      ? "Style and scene elements. Remove first/last frame to use reference images instead."
      : refImagesBlocked1080p
        ? "Style and scene elements. Only available at 480p or 720p — lower the resolution to use."
        : model.providerFamily === "kling3omni"
          ? `Style/scene refs (up to ${refVideos.done.length > 0 ? 4 : 7}). Tag with @ or upload.`
          : "Scene elements (up to 4). Tag with @ or upload.";

  return (
    <>
      <StudioForm mode="video" onSubmit={handleGenerate}>
          {/* Top-left chips: creation type + model */}
          <StudioFormHeader>
            <ChipDropdown
              sheetTitle="Select creation type"
              icon={<Layers className="h-3.5 w-3.5" />}
              value={selectedCreation?.label ?? "Creation"}
              activeId="text2video"
                options={creationTypeChipOptions(creationTypes, isAdmin)}
              onSelect={onSelectCreation}
              disabled={loading}
            />
            {/* Model chip stays inline in the top row on desktop only */}
            <div className="hidden lg:block">
              <ChipDropdown
                sheetTitle="Select model"
                icon={<Cpu className="h-3.5 w-3.5" />}
                value={model.modelLabel}
                activeId={modelId}
                options={text2videoModels.map((m) => ({
                  id: m.id,
                  label: m.modelLabel,
                  hint: formatVideoModelCreditHint(m, videoCredits),
                }))}
                onSelect={(id) => setModelId(id as VideoModelId)}
                disabled={loading}
              />
            </div>
          </StudioFormHeader>

          <StudioFormCard>
            <div className="flex items-start gap-3">
              {/* Reference media inline before the prompt on desktop */}
              {model.references.referenceImages > 0 && (
                <div className="hidden shrink-0 items-start gap-3 lg:flex">
                  <RefMediaGroup
                    label="Reference"
                    imageGroup={refImages}
                    imageAccept={IMAGE_ACCEPT}
                    videoGroup={model.references.referenceVideos > 0 ? refVideos : undefined}
                    videoAccept={VIDEO_ACCEPT}
                    disabled={refImagesDisabled}
                    disabledReason={refImagesDisabledReason}
                    hint={refImagesHint}
                  />
                </div>
              )}
              <div className="min-w-0 flex-1">
                {supportsMentions ? (
                  <MentionTextarea
                    value={prompt}
                    onChange={setPrompt}
                    mentions={mentions}
                    onMentionsChange={setMentions}
                    assets={mentionAssets}
                    maxLength={model.promptMaxChars}
                    placeholder='Describe the scene — camera moves, subject, mood. Type @ to tag a saved image from your library, or attach references below.'
                    rows={3}
                    disabled={loading}
                    className="min-h-[64px] text-base"
                  />
                ) : (
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    maxLength={model.promptMaxChars}
                    placeholder="Describe the scene — camera moves, subject, mood."
                    rows={3}
                    className="min-h-[64px] w-full resize-none bg-transparent text-base text-text-primary placeholder:text-text-disabled focus:outline-none"
                  />
                )}
              </div>
            </div>

            {/* Reference media above the controls on mobile */}
            {model.references.referenceImages > 0 && (
              <div className="mt-3 lg:hidden">
                <RefMediaGroup
                  label="Reference"
                  imageGroup={refImages}
                  imageAccept={IMAGE_ACCEPT}
                  videoGroup={model.references.referenceVideos > 0 ? refVideos : undefined}
                  videoAccept={VIDEO_ACCEPT}
                  disabled={refImagesDisabled}
                  disabledReason={refImagesDisabledReason}
                  hint={refImagesHint}
                />
              </div>
            )}

            {/* Controls row */}
            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className={STUDIO_CHIP_ROW_CLASS}>
                <ChipDropdown
                  sheetTitle="Select clip length"
                  square
                  showChevron={false}
                  icon={<Clock className="h-3.5 w-3.5" />}
                  value={`${duration}s`}
                  activeId={String(duration)}
                  tooltip="How long the generated clip is, in seconds. Longer clips cost more credits."
                  options={getAllowedDurations(model, resolution).map((d) => ({
                    id: String(d),
                    label: `${d} seconds`,
                    hint: `${videoCredits(pricingKey, d)}`,
                  }))}
                  onSelect={(id) => setDuration(Number(id))}
                  disabled={loading}
                />
                {model.resolutions.length > 1 && (
                <ChipDropdown
                  sheetTitle="Select resolution"
                  square
                  showChevron={false}
                  icon={<Maximize2 className="h-3.5 w-3.5" />}
                  value={resolution}
                  activeId={resolution}
                  tooltip="Video resolution. Higher resolution is crisper but costs more credits."
                  options={model.resolutions
                    .filter((r) => !(resolution1080pBlockedByRefs && r === "1080p"))
                    .map((r) => ({
                      id: r,
                      label: r,
                      hint: `${videoCredits(model.pricingKey({ resolution: r, hasReferenceVideo, generateAudio }), duration)}`,
                    }))}
                  onSelect={(id) => setResolution(id as VideoResolution)}
                  disabled={loading}
                />
                )}
                <ChipDropdown
                  sheetTitle="Select video ratio"
                  square
                  showChevron={false}
                  icon={<Crop className="h-3.5 w-3.5" />}
                  value={ASPECT_RATIO_LABELS[aspectRatio]}
                  activeId={aspectRatio}
                  tooltip="Shape of the frame. 9:16 is vertical (Reels/TikTok), 16:9 is widescreen, 1:1 is square."
                  options={model.aspectRatios.map((a) => ({
                    id: a,
                    label: ASPECT_RATIO_LABELS[a],
                  }))}
                  onSelect={(id) => setAspectRatio(id as VideoAspectRatio)}
                  disabled={loading}
                />
                {model.supportsAudio && (
                  <Tooltip
                    label={
                      audioBlockedByRefVideo
                        ? "Audio is unavailable when a reference video is attached."
                        : generateAudio
                          ? "On — the model generates synced audio (dialogue, SFX, music). Click to make it silent."
                          : "Off — the video is silent. Click to generate audio (may cost more)."
                    }
                  >
                    <button
                      type="button"
                      disabled={loading || audioBlockedByRefVideo}
                      onClick={() => setGenerateAudio((v) => !v)}
                      className={`flex h-10 items-center gap-2 rounded-radius-sm px-3 text-sm transition-colors disabled:opacity-40 ${
                        generateAudio
                          ? "bg-white/5 text-N700 hover:bg-white/10"
                          : "bg-white/5 text-text-disabled hover:bg-white/10 hover:text-text-secondary"
                      }`}
                    >
                      {generateAudio ? (
                        <Volume2 className="h-3.5 w-3.5 text-text-secondary" />
                      ) : (
                        <VolumeX className="h-3.5 w-3.5 text-text-disabled" />
                      )}
                      Audio
                    </button>
                  </Tooltip>
                )}
              </div>

              <div className="hidden items-center gap-3 lg:flex">
                <DevBlankTestToggle
                  isAdmin={isAdmin}
                  enabled={devBlank}
                  onChange={onDevBlankChange}
                  disabled={loading}
                />
                <CreditActionButton
                  balance={balance}
                  cost={videoCost}
                  ready={canGenerate}
                  loading={loading}
                  label="Generate"
                />
                <GenerationCancelButton
                  visible={loading}
                  cancelling={cancelling}
                  cancelAllowed={cancelAllowed}
                  onCancel={() => cancelSubmit()}
                />
              </div>
            </div>
          </StudioFormCard>

          {/* Model — attached under the form card on mobile only */}
          <StudioModelPanel>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-text-disabled">Model</span>
              <ChipDropdown
                sheetTitle="Select model"
                bare
                icon={<Cpu className="h-3.5 w-3.5" />}
                value={model.modelLabel}
                activeId={modelId}
                options={text2videoModels.map((m) => ({
                  id: m.id,
                  label: m.modelLabel,
                  hint: formatVideoModelCreditHint(m, videoCredits),
                }))}
                onSelect={(id) => setModelId(id as VideoModelId)}
                disabled={loading}
              />
            </div>
          </StudioModelPanel>

          {/* Generate (mobile — below the form card) */}
          <div className="flex flex-col gap-3 lg:hidden">
            <DevBlankTestToggle
              isAdmin={isAdmin}
              enabled={devBlank}
              onChange={onDevBlankChange}
              disabled={loading}
            />
            <div className="flex items-center gap-3">
              <CreditActionButton
                balance={balance}
                cost={videoCost}
                ready={canGenerate}
                loading={loading}
                label="Generate"
                className={`${GENERATE_BTN_CLASS} flex-1`}
              />
            <GenerationCancelButton
              visible={loading}
              cancelling={cancelling}
              cancelAllowed={cancelAllowed}
              onCancel={() => cancelSubmit()}
            />
            </div>
          </div>

          {/* References — reference images live inline beside the prompt; this
              section only carries the non-image reference types (frames, video,
              audio) and hides entirely when none apply. */}
          {(model.references.firstFrame ||
            model.references.lastFrame ||
            (model.references.referenceVideos > 0 && model.references.referenceImages === 0) ||
            model.references.referenceAudios > 0) && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 pl-1 text-xs font-semibold uppercase tracking-widest text-text-disabled sm:text-sm">
              <Sparkles className="h-3.5 w-3.5 text-text-secondary" />
              References
              <span className="font-normal normal-case tracking-normal text-text-disabled">(optional)</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {model.references.firstFrame && (
                <RefGroup
                  icon={<ImageIcon className="h-3.5 w-3.5" />}
                  label="First frame"
                  accept={IMAGE_ACCEPT}
                  multiple={false}
                  group={firstFrame}
                  disabled={loading || (blocksFramesWithRefs && hasRefImages)}
                  disabledReason={
                    blocksFramesWithRefs && hasRefImages
                      ? "Remove reference images to use a first frame."
                      : undefined
                  }
                  hint={
                    blocksFramesWithRefs && hasRefImages
                      ? "Starting frame for image-to-video. Remove reference images to use this instead."
                      : "Starting frame for image-to-video. JPG, PNG, or WebP."
                  }
                />
              )}
              {model.references.lastFrame && (
                <RefGroup
                  icon={<ImageIcon className="h-3.5 w-3.5" />}
                  label="Last frame"
                  accept={IMAGE_ACCEPT}
                  multiple={false}
                  group={lastFrame}
                  disabled={loading || (blocksFramesWithRefs && hasRefImages) || !firstFrameReady}
                  disabledReason={
                    blocksFramesWithRefs && hasRefImages
                      ? "Remove reference images to use a last frame."
                      : !firstFrameReady
                        ? "Add a first frame first."
                        : undefined
                  }
                  hint="Optional end frame for image-to-video. Upload a first frame to unlock."
                />
              )}
              {model.references.referenceVideos > 0 && model.references.referenceImages === 0 && (
                <RefGroup
                  icon={<Film className="h-3.5 w-3.5" />}
                  label="Reference videos"
                  accept={VIDEO_ACCEPT}
                  multiple={model.references.referenceVideos > 1}
                  group={refVideos}
                  disabled={loading || refVideoBlocked4k}
                  disabledReason={
                    refVideoBlocked4k ? "Reference video isn't supported at 4K." : undefined
                  }
                  hint={
                    refVideoBlocked4k
                      ? "Motion/style reference clip. Not available at 4K — lower the resolution to use."
                      : model.providerFamily === "kling3omni"
                        ? "Motion/style reference (1 clip). Use [Video1] in your prompt or upload."
                        : "Motion / style transfer. Use [Video1] in your prompt or upload."
                  }
                />
              )}
              {model.references.referenceAudios > 0 && (
                <RefGroup
                  icon={<Music className="h-3.5 w-3.5" />}
                  label="Reference audio"
                  accept={AUDIO_ACCEPT}
                  multiple
                  group={refAudios}
                  disabled={loading || !hasRefImageOrVideo}
                  disabledReason={
                    !hasRefImageOrVideo
                      ? "Add a reference image or video to use audio."
                      : undefined
                  }
                  hint="Audio-driven / lip-sync. Requires a reference image or video. Use [Audio1] in your prompt or upload."
                />
              )}
            </div>
          </div>
          )}

          {!refCheck.ok && (
            <p className="mt-2 pl-1 text-sm text-warning/80">{refCheck.error}</p>
          )}
      </StudioForm>

      {recoverableJobId && (
        <GenerationRecoverableBanner
          message={error ?? STUDIO_GENERATION_RECOVERABLE_FALLBACK}
          loading={loading}
          onResume={resumeRecoverable}
        />
      )}

      {error && !recoverableJobId && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-error/20 bg-error/10 p-4 text-sm text-error">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-text-secondary">
          <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
          Generating your video with {model.modelLabel} — this can take a couple of minutes. It will appear below when ready.
        </div>
      )}
    </>
  );
}
