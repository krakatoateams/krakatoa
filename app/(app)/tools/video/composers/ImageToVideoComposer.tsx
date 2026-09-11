"use client";

import { useEffect, useRef, useState } from "react";

import { AlertCircle, Clock, Cpu, Crop, ImageIcon, Layers, Loader2, Maximize2 } from "lucide-react";
import MentionTextarea from "@/components/MentionTextarea";
import PhotoLibraryPicker, { type LibraryImage, type PhotoLibrarySource } from "@/components/PhotoLibraryPicker";
import { nearestAspectRatio } from "@/lib/aspect-ratio-match";
import type { MentionAsset } from "@/lib/mention-assets";
import {
  ChipDropdown,
  CreditActionButton,
  GENERATE_BTN_CLASS,
  GenerationCancelButton,
  DevBlankTestToggle,
  RefGroup,
  useMediaRefs,
  STUDIO_CHIP_ROW_CLASS,
  StudioForm,
  StudioFormCard,
  StudioFormHeader,
  StudioModelPanel,
  useStudioGenerationPreview,
} from "@/components/studio";

import { useStudioGenerationSubmit } from "@/lib/studio-generation-submit";

import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { usePricing } from "@/app/(app)/pricing-context";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { consumePendingDraft } from "@/lib/pending-form-draft";

import {
  IMAGE_TO_VIDEO_MODELS,
  DEFAULT_IMAGE_TO_VIDEO_MODEL_ID,
  getVideoModel,
  getAllowedDurations,
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
  IMAGE_ACCEPT,
  creationTypeChipOptions,
  GenerationRecoverableBanner,
} from "./shared";
import type { VideoCreationTypeOption } from "./types";

export default function ImageToVideoComposer({
  initialStartImageCreationId,
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
  /** Library photo to preselect as the start frame (Photo → video "Animate"). */
  initialStartImageCreationId: string | null;
  /** Prefill from a viral-template deep-link (`?prompt=`). */
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
  const image2videoModels = filterEnabledCatalog(
    IMAGE_TO_VIDEO_MODELS,
    "image2video",
    composerEnablement
  );
  const [modelId, setModelId] = useState<VideoModelId>(DEFAULT_IMAGE_TO_VIDEO_MODEL_ID);
  const model = getVideoModel(modelId);

  useEffect(() => {
    if (image2videoModels.length === 0) return;
    const next = snapToEnabledModel(
      modelId,
      image2videoModels,
      "image2video",
      composerEnablement
    ) as VideoModelId;
    if (next !== modelId) setModelId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image2videoModels.map((m) => m.id).join(","), composerEnablement]);

  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [mentions, setMentions] = useState<MentionAsset[]>([]);
  const [imageSource, setImageSource] = useState<PhotoLibrarySource>(
    initialStartImageCreationId ? "library" : "upload"
  );
  const [libraryImage, setLibraryImage] = useState<LibraryImage | null>(null);
  const [endImageSource, setEndImageSource] = useState<PhotoLibrarySource>("upload");
  const [endLibraryImage, setEndLibraryImage] = useState<LibraryImage | null>(null);
  const [duration, setDuration] = useState<number>(model.defaultDuration);
  const [resolution, setResolution] = useState(model.defaultResolution);
  const [aspectRatio, setAspectRatio] = useState(model.defaultAspectRatio);
  // Once the user picks a ratio by hand, stop matching it to the source photo.
  const ratioTouchedRef = useRef(false);

  useEffect(() => {
    const m = getVideoModel(modelId);
    setResolution((r) => (m.resolutions.includes(r) ? r : m.defaultResolution));
    setAspectRatio((a) => (m.aspectRatios.includes(a) ? a : m.defaultAspectRatio));
    if (!m.references.lastFrame) setEndLibraryImage(null);
  }, [modelId]);

  // Restore what was typed before a gated Generate click sent the visitor
  // through sign-in — see lib/pending-form-draft.ts.
  useEffect(() => {
    const draft = consumePendingDraft<{
      prompt?: string;
      duration?: number;
      resolution?: VideoResolution;
      aspectRatio?: VideoAspectRatio;
      hadMedia?: boolean;
    }>(window.location.pathname);
    if (!draft) return;
    if (draft.prompt) setPrompt(draft.prompt);
    if (draft.duration) setDuration(draft.duration);
    if (draft.resolution) setResolution(draft.resolution);
    if (draft.aspectRatio) setAspectRatio(draft.aspectRatio);
    // Any uploaded start/end frame image can't survive the round trip (see
    // lib/pending-form-draft.ts) — only warn about it if one was actually
    // attached (hadMedia), not on every restore.
    setRestoreNotice(
      draft.hadMedia
        ? "Signed in — your settings were saved. Please re-attach your start/end image if you'd uploaded one."
        : "Signed in — your settings were saved."
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const { videoCredits } = usePricing();
  const { balance, refetch: refetchCredits } = useCreditBalance();
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
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
    idempotencyScope: "video:image-to-video",
    refetchCredits,
    refreshHistory: onGenerated,
    openPreviewFromResponse,
  });

  const startImage = useMediaRefs("image", 1);
  const endImage = useMediaRefs("image", 1);
  const refImages = useMediaRefs("image", model.references.referenceImages);

  useEffect(() => {
    if (!getVideoModel(modelId).references.lastFrame) endImage.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  useEffect(() => {
    if (getVideoModel(modelId).references.referenceImages === 0) refImages.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  const startImageUrl =
    imageSource === "library" ? (libraryImage?.url ?? null) : (startImage.done[0]?.url ?? null);

  // Match the frame to the source photo: animating a square photo in the default
  // 9:16 frame would letterbox it. Measured in the browser because the photo's
  // shape isn't stored on the creation, so this also works for older photos.
  // An explicit ratio pick always wins — see ratioTouchedRef.
  useEffect(() => {
    if (!startImageUrl || ratioTouchedRef.current) return;
    let active = true;
    const probe = new window.Image();
    probe.onload = () => {
      if (!active) return;
      const next = nearestAspectRatio(probe.naturalWidth, probe.naturalHeight, model.aspectRatios);
      if (next) setAspectRatio(next);
    };
    // Read the shape off a 64 px thumbnail from the Next optimizer instead of the
    // original: resizing preserves the ratio, and downloading a multi-megabyte PNG
    // just to learn its dimensions is exactly the Supabase egress the optimizer
    // exists to avoid (see the egress notes in CLAUDE.md). 64 is one of Next's
    // default imageSizes, so the optimizer accepts the width. If it ever refuses,
    // onload never fires and the ratio simply stays on the model default.
    probe.src = `/_next/image?url=${encodeURIComponent(startImageUrl)}&w=64&q=25`;
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startImageUrl]);

  const pricingKey = model.pricingKey({ resolution });
  const cost = devBlank ? 0 : videoCredits(pricingKey, duration);

  const startUploadedReady = startImage.done.length > 0;
  const startLibraryReady = libraryImage !== null;
  const startReady = imageSource === "upload" ? startUploadedReady : startLibraryReady;
  const endUploadedReady = endImage.done.length > 0;
  const endLibraryReady = endLibraryImage !== null;
  const endReady = endImageSource === "upload" ? endUploadedReady : endLibraryReady;
  const frameReady = model.requiresFirstFrame
    ? startReady
    : model.references.lastFrame
      ? startReady || endReady
      : startReady;

  // Kling v2.1: end_image requires pro (1080p) mode.
  useEffect(() => {
    if (model.providerFamily !== "kling21") return;
    if (endReady && resolution !== "1080p") setResolution("1080p");
  }, [model.providerFamily, endReady, resolution]);

  const anyUploading =
    (imageSource === "upload" && startImage.uploading) ||
    (model.references.lastFrame && endImageSource === "upload" && endImage.uploading) ||
    refImages.uploading;
  const canGenerate = !loading && !anyUploading && frameReady && prompt.trim().length > 0;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate) return;
    if (status !== "authenticated") {
      openSignInModal(undefined, {
        prompt,
        duration,
        resolution,
        aspectRatio,
        hadMedia: startReady || endReady,
      });
      return;
    }

    const body = {
      modelId,
      prompt: prompt.trim(),
      duration,
      resolution,
      aspectRatio,
      generateAudio: false,
      startImageCreationId:
        imageSource === "library" && libraryImage ? libraryImage.id : undefined,
      endImageCreationId:
        model.references.lastFrame && endImageSource === "library" && endLibraryImage
          ? endLibraryImage.id
          : undefined,
      referenceCreationIds: mentions.map((m) => m.id),
      references: {
        firstFrame: imageSource === "upload" ? (startImage.done[0] ?? null) : null,
        lastFrame:
          model.references.lastFrame && endImageSource === "upload"
            ? (endImage.done[0] ?? null)
            : null,
        referenceImages: refImages.done.map((r) => ({ url: r.url, path: r.path })),
        referenceVideos: [],
        referenceAudios: [],
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
        fallbackCost: cost,
        onSuccess: () => {
          startImage.reset();
          endImage.reset();
          refImages.reset();
          setLibraryImage(null);
          setEndLibraryImage(null);
          setMentions([]);
        },
      },
    );
  };

  return (
    <>
      <StudioForm mode="video" onSubmit={handleGenerate}>
        <StudioFormHeader>
          <ChipDropdown
            sheetTitle="Select creation type"
            icon={<Layers className="h-3.5 w-3.5" />}
            value="Image to video"
            activeId="image2video"
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
              options={image2videoModels.map((m) => ({
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
          <div
            className={`grid grid-cols-1 gap-3 ${
              model.references.lastFrame ? "lg:grid-cols-3" : "sm:grid-cols-2"
            }`}
          >
            <PhotoLibraryPicker
              label={model.requiresFirstFrame ? "Start image" : "Start image (optional)"}
              icon={<ImageIcon className="h-3.5 w-3.5" />}
              accept={IMAGE_ACCEPT}
              group={startImage}
              source={imageSource}
              onSourceChange={(s) => {
                setImageSource(s);
                if (s === "upload") setLibraryImage(null);
                else startImage.reset();
              }}
              selected={libraryImage}
              onSelect={setLibraryImage}
              preselectId={initialStartImageCreationId}
              disabled={loading}
              hint={
                model.requiresFirstFrame
                  ? "Required — pick from your library or upload."
                  : "Optional if you provide an end image."
              }
            />
              {model.references.lastFrame && (
              <PhotoLibraryPicker
                label="End image (optional)"
                icon={<ImageIcon className="h-3.5 w-3.5" />}
                accept={IMAGE_ACCEPT}
                group={endImage}
                source={endImageSource}
                onSourceChange={(s) => {
                  setEndImageSource(s);
                  if (s === "upload") setEndLibraryImage(null);
                  else endImage.reset();
                }}
                selected={endLibraryImage}
                onSelect={setEndLibraryImage}
                disabled={loading}
                hint={
                  model.providerFamily === "kling21"
                    ? "Optional — requires Pro (1080p) when set."
                    : "Optional if you provide a start image — at least one frame is required."
                }
              />
            )}
            <div
              className={`flex min-h-[120px] flex-col rounded-2xl border border-dashed border-white/10 bg-N0/20 p-3 ${
                model.references.lastFrame ? "lg:col-span-1" : "sm:col-span-1"
              }`}
            >
              <MentionTextarea
                value={prompt}
                onChange={setPrompt}
                mentions={mentions}
                onMentionsChange={setMentions}
                assets={mentionAssets}
                maxLength={model.promptMaxChars}
                placeholder="Describe how the scene should move. Type @ to reference a saved image."
                rows={4}
                disabled={loading}
                className="min-h-[80px] text-sm"
              />
            </div>
          </div>

          {model.references.referenceImages > 0 && (
            <div className="mt-3">
              <RefGroup
                icon={<ImageIcon className="h-3.5 w-3.5" />}
                label="Scene references"
                accept={IMAGE_ACCEPT}
                multiple
                group={refImages}
                disabled={loading}
                hint={`Optional scene elements (up to ${model.references.referenceImages}). Tag with @ in the prompt or upload here.`}
              />
            </div>
          )}

          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className={STUDIO_CHIP_ROW_CLASS}>
              <ChipDropdown
                sheetTitle="Select clip length"
                square
                showChevron={false}
                icon={<Clock className="h-3.5 w-3.5" />}
                value={`${duration}s`}
                activeId={String(duration)}
                tooltip="Clip length in seconds."
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
                  value={
                    model.providerFamily === "kling21"
                      ? resolution === "1080p"
                        ? "Pro · 1080p"
                        : "Standard · 720p"
                      : resolution
                  }
                  activeId={resolution}
                  tooltip={
                    model.providerFamily === "kling21"
                      ? "Standard is 720p; Pro is 1080p. End image requires Pro."
                      : "Output resolution."
                  }
                  options={model.resolutions
                    .filter((r) => !(model.providerFamily === "kling21" && endReady && r === "720p"))
                    .map((r) => ({
                      id: r,
                      label:
                        model.providerFamily === "kling21"
                          ? r === "720p"
                            ? "Standard · 720p"
                            : "Pro · 1080p"
                          : r,
                      hint: `${videoCredits(model.pricingKey({ resolution: r }), duration)}`,
                    }))}
                  onSelect={(id) => setResolution(id as typeof resolution)}
                  disabled={loading}
                />
              )}
              {model.aspectRatios.length > 1 && (
              <ChipDropdown
                sheetTitle="Select video ratio"
                square
                showChevron={false}
                icon={<Crop className="h-3.5 w-3.5" />}
                value={ASPECT_RATIO_LABELS[aspectRatio]}
                activeId={aspectRatio}
                tooltip="Frame shape."
                options={model.aspectRatios.map((a) => ({
                  id: a,
                  label: ASPECT_RATIO_LABELS[a],
                }))}
                onSelect={(id) => {
                  ratioTouchedRef.current = true;
                  setAspectRatio(id as typeof aspectRatio);
                }}
                disabled={loading}
              />
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
                cost={cost}
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
              options={image2videoModels.map((m) => ({
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
              cost={cost}
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
      </StudioForm>

      {recoverableJobId && error && (
        <GenerationRecoverableBanner
          message={error}
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

      {restoreNotice && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-warning/20 bg-warning/10 p-4 text-sm text-warning">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{restoreNotice}</span>
        </div>
      )}

      {loading && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-text-secondary">
          <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
          Generating with {model.modelLabel} — this can take a couple of minutes.
        </div>
      )}

    </>
  );
}
