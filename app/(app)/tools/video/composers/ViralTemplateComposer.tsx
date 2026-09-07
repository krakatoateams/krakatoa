"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { AlertCircle, ArrowRight, Clock, Cpu, Crop, Film, Layers, Loader2, Maximize2 } from "lucide-react";
import {
  ChipDropdown,
  CreditActionButton,
  GENERATE_BTN_CLASS,
  GenerationCancelButton,
  DevBlankTestToggle,
  useMediaRefs,
  STUDIO_CHIP_ROW_CLASS,
  StudioForm,
  StudioFormCard,
  StudioFormHeader,
  StudioModelPanel,
  useStudioGenerationPreview,
} from "@/components/studio";

import { useStudioGenerationSubmit } from "@/lib/studio-generation-submit";
import { STUDIO_GENERATION_RECOVERABLE_FALLBACK } from "@/lib/studio-generation-response";

import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { usePricing } from "@/app/(app)/pricing-context";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";

import {
  VIRAL_TEMPLATE_MODELS,
  getVideoModel,
  getAllowedDurations,
  formatVideoModelCreditHint,
  supportsViralTemplateGeneration,
  viralTemplateUsesCharacterImageOnly,
  type VideoModelId,
  type VideoResolution,
  type VideoAspectRatio,
} from "@/lib/video-models";
import {
  filterEnabledCatalog,
  snapToEnabledModel,
  defaultModelForComposer,
  type VideoComposerKey,
  type VideoComposerEnablement,
} from "@/lib/video-composer-features";
import { viralTemplateLabel, type TrendingTemplate } from "@/lib/trending-templates";
import {
  CharacterPicker,
  ASPECT_RATIO_LABELS,
  creationTypeChipOptions,
  GenerationRecoverableBanner,
} from "./shared";
import type { CharacterSource, LibraryCharacter, VideoCreationTypeOption } from "./types";

export default function ViralTemplateComposer({
  initialTemplate,
  creationTypes,
  isAdmin,
  devBlank,
  onDevBlankChange,
  composerEnablement,
  onSelectCreation,
  onGenerated,
}: {
  initialTemplate: TrendingTemplate | null | undefined;
  creationTypes: VideoCreationTypeOption[];
  isAdmin: boolean;
  devBlank: boolean;
  onDevBlankChange: (next: boolean) => void;
  composerEnablement: Record<VideoComposerKey, VideoComposerEnablement> | null;
  onSelectCreation: (id: string) => void;
  onGenerated: () => void;
}) {
  const { openPreviewFromResponse } = useStudioGenerationPreview();
  const viralTemplateModels = filterEnabledCatalog(
    VIRAL_TEMPLATE_MODELS,
    "viral_template",
    composerEnablement
  );
  const [modelId, setModelId] = useState<VideoModelId>(
    () => defaultModelForComposer("viral_template") as VideoModelId
  );
  const model = getVideoModel(modelId);

  const template = initialTemplate ?? null;
  const lockedPrompt = template?.prompt?.trim() ?? "";
  const templateStartFramePath = template?.referenceImageUrl ?? null;

  useEffect(() => {
    if (viralTemplateModels.length === 0) return;
    const next = snapToEnabledModel(
      modelId,
      viralTemplateModels,
      "viral_template",
      composerEnablement
    ) as VideoModelId;
    if (next !== modelId) setModelId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viralTemplateModels.map((m) => m.id).join(","), composerEnablement]);

  const [charSource, setCharSource] = useState<CharacterSource>("upload");
  const [libraryChar, setLibraryChar] = useState<LibraryCharacter | null>(null);
  const [duration, setDuration] = useState<number>(model.defaultDuration);
  const [resolution, setResolution] = useState(model.defaultResolution);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>(
    model.aspectRatios.includes("9:16") ? "9:16" : model.defaultAspectRatio
  );
  const ratioTouchedRef = useRef(false);

  useEffect(() => {
    const m = getVideoModel(modelId);
    setResolution((r) => (m.resolutions.includes(r) ? r : m.defaultResolution));
    if (!ratioTouchedRef.current) {
      setAspectRatio(m.aspectRatios.includes("9:16") ? "9:16" : m.defaultAspectRatio);
    }
  }, [modelId]);

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
    refetchCredits,
    refreshHistory: onGenerated,
    openPreviewFromResponse,
  });

  const charImage = useMediaRefs("image", 1);

  const pricingKey = model.pricingKey({ resolution });
  const cost = devBlank ? 0 : videoCredits(pricingKey, duration);

  const charReady =
    charSource === "library" ? libraryChar !== null : charImage.done.length > 0;
  const anyUploading = charSource === "upload" && charImage.uploading;
  const canGenerate =
    !loading &&
    !anyUploading &&
    charReady &&
    lockedPrompt.length > 0 &&
    template !== null &&
    templateStartFramePath !== null &&
    viralTemplateModels.length > 0 &&
    supportsViralTemplateGeneration(model);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate || !templateStartFramePath) return;
    if (status !== "authenticated") {
      openSignInModal(undefined, { duration, resolution, aspectRatio });
      return;
    }

    const grokViral = viralTemplateUsesCharacterImageOnly(model);
    const charUpload =
      charSource === "upload" && charImage.done[0]
        ? { url: charImage.done[0].url, path: charImage.done[0].path }
        : null;

    const body = {
      modelId,
      prompt: lockedPrompt,
      viralTemplateId: template.id,
      viralTemplateStartFramePath: grokViral ? null : templateStartFramePath,
      duration,
      resolution,
      aspectRatio,
      generateAudio: false,
      referenceCreationIds:
        charSource === "library" && libraryChar ? [libraryChar.id] : [],
      references: {
        firstFrame: grokViral && charUpload ? charUpload : null,
        lastFrame: null,
        referenceImages: !grokViral && charUpload ? [charUpload] : [],
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
          charImage.reset();
          setLibraryChar(null);
        },
      },
    );
  };

  const templateVideoUrl = template?.videoUrl ?? "";

  return (
    <>
      <StudioForm mode="video" onSubmit={handleGenerate}>
        <StudioFormHeader>
          <ChipDropdown
            sheetTitle="Select creation type"
            icon={<Layers className="h-3.5 w-3.5" />}
            value="Viral Template"
            activeId="viral_template"
            options={creationTypeChipOptions(creationTypes, isAdmin)}
            onSelect={onSelectCreation}
            disabled={loading}
          />
          <div className="hidden lg:block">
            <ChipDropdown
              sheetTitle="Select model"
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={model.modelLabel}
              activeId={modelId}
              options={viralTemplateModels.map((m) => ({
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CharacterPicker
              group={charImage}
              source={charSource}
              onSourceChange={setCharSource}
              selected={libraryChar}
              onSelect={setLibraryChar}
              disabled={loading || !template}
            />
            {template ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                  <Film className="h-3.5 w-3.5" />
                  {viralTemplateLabel(template)}
                  {(template.shotCount ?? 1) > 1 ? (
                    <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-medium normal-case text-text-primary">
                      {template.shotCount} shots
                    </span>
                  ) : null}
                  <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-N700">
                    locked
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-radius-sm border border-white/10 bg-N0/40">
                    <video
                      src={templateVideoUrl}
                      muted
                      loop
                      playsInline
                      autoPlay
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  </div>
                  <p className="text-[11px] text-text-secondary">
                    {viralTemplateUsesCharacterImageOnly(model)
                      ? "Upload a clear photo of your character — Grok uses that image for face and body identity; template beats and multi-shot structure come from the locked prompt."
                      : "Upload a clear photo of your character — [Image1] in the prompt is your upload only. The locked template still sets the scene start frame; your character reference defines who appears on screen."}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4">
                <p className="text-sm text-text-secondary">
                  Pick a viral template from your dashboard — use template is only available there.
                </p>
                <Link
                  href="/dashboard"
                  className="mt-3 inline-flex w-fit items-center gap-2 rounded-radius-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-white/10"
                >
                  Go to dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </div>

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
                disabled={loading || !template}
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
                      ? "Standard is 720p; Pro is 1080p."
                      : "Output resolution."
                  }
                  options={model.resolutions.map((r) => ({
                    id: r,
                    label:
                      model.providerFamily === "kling21"
                        ? r === "720p"
                          ? "Standard · 720p"
                          : "Pro · 1080p"
                        : r,
                    hint: `${videoCredits(model.pricingKey({ resolution: r }), duration)}`,
                  }))}
                  onSelect={(id) => setResolution(id as VideoResolution)}
                  disabled={loading || !template}
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
                  options={model.aspectRatios.map((r) => ({
                    id: r,
                    label: ASPECT_RATIO_LABELS[r],
                  }))}
                  onSelect={(id) => {
                    ratioTouchedRef.current = true;
                    setAspectRatio(id as VideoAspectRatio);
                  }}
                  disabled={loading || !template}
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

        <StudioModelPanel>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-text-disabled">Model</span>
            <ChipDropdown
              sheetTitle="Select model"
              bare
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={model.modelLabel}
              activeId={modelId}
              options={viralTemplateModels.map((m) => ({
                id: m.id,
                label: m.modelLabel,
                hint: formatVideoModelCreditHint(m, videoCredits),
              }))}
              onSelect={(id) => setModelId(id as VideoModelId)}
              disabled={loading}
            />
          </div>
        </StudioModelPanel>

        <div className="mt-3 flex flex-col gap-3 lg:hidden">
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

      {error && !recoverableJobId && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-error/20 bg-error/10 p-4 text-sm text-error">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {recoverableJobId && (
        <GenerationRecoverableBanner
          message={error ?? STUDIO_GENERATION_RECOVERABLE_FALLBACK}
          loading={loading}
          onResume={resumeRecoverable}
        />
      )}

      {loading && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-text-secondary">
          <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
          Generating your viral clip with {model.modelLabel} — this can take a couple of minutes.
        </div>
      )}

    </>
  );
}
