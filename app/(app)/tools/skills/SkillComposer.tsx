"use client";

import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Clock,
  Cpu,
  Crop,
  ImageIcon,
  Loader2,
  Maximize2,
} from "lucide-react";
import {
  ChipDropdown,
  CreditActionButton,
  GENERATE_BTN_CLASS,
  GenerationCancelButton,
  RefGroup,
  STUDIO_CHIP_ROW_CLASS,
  StudioForm,
  StudioFormCard,
  StudioFormHeader,
  StudioGenerationPreviewProvider,
  StudioModelPanel,
  UploadTile,
  useImageUpload,
  useMediaRefs,
  useStudioGenerationPreview,
} from "@/components/studio";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { usePricing } from "@/app/(app)/pricing-context";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useIdempotentSubmit } from "@/lib/use-idempotent-submit";
import { useGenerationStatusPoll } from "@/lib/use-generation-status-poll";
import { pickGenerateStoragePath } from "@/lib/use-signed-media-url";
import {
  DEFAULT_MODEL_POSE,
  DEFAULT_PHOTO_ASPECT_RATIO,
  DEFAULT_PHOTO_STYLE,
  DEFAULT_PRODUCT_PHOTO_RESOLUTION,
  DEFAULT_PRODUCT_PHOTO_TIER,
  PHOTO_ASPECT_RATIOS,
  PRODUCT_PHOTO_TIERS,
  getProductPhotoTier,
  tierSupportsMultiReference,
  type PhotoAspectRatio,
  type ProductPhotoModelTier,
  type ProductPhotoResolution,
} from "@/lib/product-photo";
import {
  DEFAULT_VIDEO_MODEL_ID,
  getAllowedDurations,
  getVideoModel,
  type VideoAspectRatio,
  type VideoResolution,
} from "@/lib/video-models";
import {
  isAgentSkill,
  skillHref,
  skillPhotoMode,
  type SkillId,
} from "@/lib/skills";
import FeaturedSkillsRow from "./FeaturedSkillsRow";
import SkillPicker from "./SkillPicker";
import { SkillsCatalogProvider, useSkillsCatalog } from "./SkillsCatalogProvider";

const AGENT_PLACEHOLDER = "Pick a skill to get started.";
const SKILL_PROMPT_FALLBACK = "Describe what you want to create.";

function describeIdempotencyError(
  status: number,
  data: { code?: string; error?: string }
): string | null {
  if (status === 409 && data?.code === "GENERATION_CANCELLED") return null;
  if (status === 409 && data?.code === "GENERATION_IN_PROGRESS") {
    return "Generation already in progress, please wait.";
  }
  if (status === 409 && data?.code === "IDEMPOTENCY_CONFLICT") {
    return data?.error || "This request conflicts with a previous one.";
  }
  if (status === 400 && data?.code === "IDEMPOTENCY_KEY_REQUIRED") {
    return data?.error || "Missing idempotency key. Please retry.";
  }
  return null;
}

function SkillOmniInner({
  onHistoryRefresh,
  embed = false,
}: {
  historyRefreshKey: number;
  onHistoryRefresh: () => void;
  embed?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const { openPreviewFromResponse } = useStudioGenerationPreview();
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling, activeKey } = useIdempotentSubmit();
  const { cancelAllowed } = useGenerationStatusPoll(activeKey);
  const { balance, refetch: refetchCredits } = useCreditBalance();
  const { imageCredits, videoCredits } = usePricing();

  const { skillById } = useSkillsCatalog();
  const skillFromUrl = skillById(searchParams.get("skill") ?? "");
  const [skillId, setSkillId] = useState<SkillId | null>(
    skillFromUrl && isAgentSkill(skillFromUrl) ? skillFromUrl.id : null
  );
  const skill = skillId ? skillById(skillId) : undefined;
  const ignoreUrlSkillRef = useRef<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectSkill = useCallback(
    (id: SkillId) => {
      const next = skillById(id);
      if (!next || !isAgentSkill(next)) return;
      setError(null);
      if (skillId === id) {
        ignoreUrlSkillRef.current = id;
        setSkillId(null);
        startTransition(() => {
          const params = new URLSearchParams(searchParams.toString());
          params.delete("skill");
          const qs = params.toString();
          router.replace(qs ? `/dashboard?${qs}` : "/dashboard", { scroll: false });
        });
        return;
      }
      ignoreUrlSkillRef.current = null;
      setSkillId(id);
      startTransition(() => {
        router.replace(skillHref(id), { scroll: false });
      });
    },
    [router, searchParams, skillById, skillId]
  );

  useEffect(() => {
    const next = searchParams.get("skill");
    if (ignoreUrlSkillRef.current) {
      if (next === ignoreUrlSkillRef.current) return;
      ignoreUrlSkillRef.current = null;
    }
    const fromUrl = next ? skillById(next) : undefined;
    if (fromUrl && isAgentSkill(fromUrl)) {
      setSkillId(fromUrl.id);
      return;
    }
    setSkillId(null);
  }, [searchParams, skillById]);

  const subject = useImageUpload();
  const scene = useImageUpload();
  const character = useImageUpload();
  const startFrame = useMediaRefs("image", 1);

  const isVideo = skill?.mediaType === "video";
  const hasSlot = (key: string) => !!skill?.inputs.some((slot) => slot.key === key);
  const needsCharacter = !!skill?.inputs.some((slot) => slot.key === "character" && slot.required);
  const needsSubject = !!skill?.inputs.some((slot) => slot.key === "subject" && slot.required);
  const needsScene = !!skill?.inputs.some((slot) => slot.key === "scene" && slot.required);
  const needsStartFrame = !!skill?.inputs.some((slot) => slot.key === "startFrame" && slot.required);
  const showSubjectTile = Boolean(skill) && !isVideo && hasSlot("subject");
  const showStartFrame = isVideo && hasSlot("startFrame");
  const showScene = hasSlot("scene");
  const showCharacter = hasSlot("character");
  const subjectLabel =
    skill?.inputs.find((slot) => slot.key === "subject")?.label ?? "Ref";
  const mobileSubjectLabel =
    subjectLabel === "Ref" ? "Add reference" : subjectLabel;
  const startFrameLabel =
    skill?.inputs.find((slot) => slot.key === "startFrame")?.label ?? "Start frame";

  const photoTiers = useMemo(() => {
    if (needsCharacter) return PRODUCT_PHOTO_TIERS.filter(tierSupportsMultiReference);
    if (needsSubject || subject.file) {
      return PRODUCT_PHOTO_TIERS.filter((t) => t.supportsReference);
    }
    return PRODUCT_PHOTO_TIERS;
  }, [needsCharacter, needsSubject, subject.file]);
  const defaultPhotoTier =
    photoTiers.find((t) => t.id === DEFAULT_PRODUCT_PHOTO_TIER)?.id ??
    photoTiers[0]?.id ??
    DEFAULT_PRODUCT_PHOTO_TIER;

  const [modelTier, setModelTier] = useState<ProductPhotoModelTier>(defaultPhotoTier);
  const [resolution, setResolution] = useState<ProductPhotoResolution>(
    DEFAULT_PRODUCT_PHOTO_RESOLUTION
  );
  const [aspectRatio, setAspectRatio] = useState<PhotoAspectRatio>(DEFAULT_PHOTO_ASPECT_RATIO);

  const tier = getProductPhotoTier(modelTier);
  useEffect(() => {
    if (!photoTiers.some((t) => t.id === modelTier) && photoTiers[0]) {
      setModelTier(photoTiers[0].id);
    }
  }, [modelTier, photoTiers]);

  useEffect(() => {
    if (!tier.hasResolution) return;
    if (!tier.resolutions.some((r) => r.id === resolution)) {
      setResolution(tier.resolutions[0].id);
    }
  }, [tier, resolution]);

  const videoModel = getVideoModel(DEFAULT_VIDEO_MODEL_ID);
  const [duration, setDuration] = useState(videoModel.defaultDuration);
  const [videoResolution, setVideoResolution] = useState<VideoResolution>(
    videoModel.defaultResolution
  );
  const [videoAspect, setVideoAspect] = useState<VideoAspectRatio>(videoModel.defaultAspectRatio);

  const allowedDurations = getAllowedDurations(videoModel, videoResolution);
  useEffect(() => {
    if (!allowedDurations.includes(duration) && allowedDurations[0]) {
      setDuration(allowedDurations[0]);
    }
  }, [allowedDurations, duration]);

  const photoPricingKey = tier.hasResolution
    ? tier.resolutions.find((r) => r.id === resolution)?.pricingKey ??
      tier.resolutions[0].pricingKey
    : tier.basicPricingKey!;
  const photoCost = imageCredits(photoPricingKey, 1);
  const videoPricingKey = videoModel.pricingKey({
    resolution: videoResolution,
    generateAudio: videoModel.defaultGenerateAudio,
  });
  const videoCost = videoCredits(videoPricingKey, duration);
  const cost = !skill ? 0 : isVideo ? videoCost : photoCost;

  const startFrameReady = startFrame.items.length === 0 || startFrame.done.length > 0;
  const canGeneratePhoto =
    !!skill &&
    (!skill.promptRequired || prompt.trim().length > 0) &&
    (!needsSubject || !!subject.file) &&
    (!needsScene || !!scene.file) &&
    (!needsCharacter || !!character.file) &&
    photoTiers.length > 0;
  const canGenerateVideo =
    !!skill &&
    (!skill.promptRequired || prompt.trim().length > 0) &&
    startFrameReady &&
    !startFrame.uploading &&
    (!needsStartFrame || startFrame.done.length > 0);
  const canGenerate = skill ? (isVideo ? canGenerateVideo : canGeneratePhoto) : false;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate || !skill) return;
    if (status !== "authenticated") {
      openSignInModal();
      return;
    }

    if (isVideo) {
      const body = {
        skillId: skill.id,
        modelId: videoModel.id,
        prompt: prompt.trim(),
        duration,
        resolution: videoResolution,
        aspectRatio: videoAspect,
        generateAudio: videoModel.defaultGenerateAudio,
        references: {
          firstFrame: startFrame.done[0] ?? null,
        },
      };
      const attempt = beginSubmit(JSON.stringify(body));
      if (!attempt) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/generate-video", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": attempt.key,
          },
          body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (data.code === "GENERATION_CANCELLED") {
            attempt.settle(false);
            refetchCredits();
            return;
          }
          if (response.status === 402) {
            throw new Error(
              `Insufficient credits. Required: ${data.requiredCredits ?? cost}, current: ${data.currentBalance ?? 0}.`
            );
          }
          const idemMsg = describeIdempotencyError(response.status, data);
          if (idemMsg) throw new Error(idemMsg);
          throw new Error(data.error || "Generation failed");
        }
        attempt.settle(true);
        refetchCredits();
        onHistoryRefresh();
        void openPreviewFromResponse(data);
      } catch (err) {
        attempt.settle(false);
        setError(err instanceof Error ? err.message : "Generation failed");
      } finally {
        setLoading(false);
      }
      return;
    }

    const formData = new FormData();
    formData.append("skillId", skill.id);
    formData.append("poseId", DEFAULT_MODEL_POSE);
    formData.append("styleId", DEFAULT_PHOTO_STYLE);
    formData.append("modelTier", modelTier);
    formData.append("aspectRatio", aspectRatio);
    if (tier.hasResolution) formData.append("resolution", resolution);
    if (prompt.trim()) formData.append("prompt", prompt.trim());
    const photoMode = skillPhotoMode(skill) ?? "image";
    formData.append("mode", photoMode);
    if (photoMode === "product") {
      if (scene.file) formData.append("image", scene.file);
      if (character.file) formData.append("character", character.file);
    } else if (subject.file) {
      formData.append("reference", subject.file);
    } else if (character.file) {
      formData.append("reference", character.file);
    }

    const signature = [
      skill.id,
      prompt.trim(),
      modelTier,
      aspectRatio,
      resolution,
      subject.file?.name ?? "",
      scene.file?.name ?? "",
      character.file?.name ?? "",
    ].join("|");
    const attempt = beginSubmit(signature);
    if (!attempt) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/generate-photo", {
        method: "POST",
        headers: { "Idempotency-Key": attempt.key },
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && data.code === "GENERATION_CANCELLED") {
          attempt.settle(false);
          refetchCredits();
          return;
        }
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? cost}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Generation failed");
      }
      attempt.settle(true);
      refetchCredits();
      onHistoryRefresh();
      void openPreviewFromResponse({
        ...data,
        storagePath: pickGenerateStoragePath(data),
      });
    } catch (err) {
      attempt.settle(false);
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const photoModelOptions = photoTiers.map((t) => ({
    id: t.id,
    label: t.modelLabel,
    hint: t.hasResolution
      ? `${imageCredits(t.resolutions[0].pricingKey, 1)}+`
      : `${imageCredits(t.basicPricingKey!, 1)}`,
  }));
  const showUploads = showSubjectTile || showScene || showCharacter || showStartFrame;

  return (
    <>
      <StudioForm
        mode="agent"
        onSubmit={handleGenerate}
        className={embed ? "!mt-0 !py-0" : ""}
      >
        <input
          ref={subject.inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={subject.onChange}
        />
        <input
          ref={scene.inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={scene.onChange}
        />
        <input
          ref={character.inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={character.onChange}
        />

        {embed ? (
          <StudioFormHeader className="w-full min-w-0 !flex-nowrap lg:hidden">
            <FeaturedSkillsRow
              activeSkillId={skillId}
              onSelectSkill={selectSkill}
              className="min-w-0 flex-1"
            />
          </StudioFormHeader>
        ) : null}

        {!isVideo && skill ? (
          <StudioFormHeader className="hidden lg:flex">
            <ChipDropdown
              sheetTitle="Select model"
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={tier.modelLabel}
              activeId={modelTier}
              options={photoModelOptions}
              onSelect={(id) => setModelTier(id as ProductPhotoModelTier)}
              disabled={loading}
            />
          </StudioFormHeader>
        ) : null}

            {showUploads && (
              <div className="flex items-stretch gap-3 lg:hidden">
                {showSubjectTile && (
                  <UploadTile
                    label={mobileSubjectLabel}
                    upload={subject}
                    disabled={loading}
                    fluid
                  />
                )}
                {showScene && <UploadTile label="Scene" upload={scene} disabled={loading} fluid />}
                {showCharacter && (
                  <UploadTile label="Character" upload={character} disabled={loading} fluid />
                )}
                {showStartFrame && (
                  <RefGroup
                    icon={<ImageIcon className="h-3.5 w-3.5" />}
                    label={startFrameLabel}
                    accept="image/jpeg,image/png,image/webp"
                    multiple={false}
                    group={startFrame}
                    disabled={loading}
                    bare
                    fluid
                  />
                )}
              </div>
            )}

            <StudioFormCard>
          <div className="flex items-start gap-3">
            {(showSubjectTile || showStartFrame) && (
              <div className="hidden shrink-0 items-start gap-3 lg:flex">
                {showSubjectTile && (
                  <UploadTile
                    label={subjectLabel}
                    upload={subject}
                    disabled={loading}
                    iconOnly
                  />
                )}
                {showStartFrame && (
                  <RefGroup
                    icon={<ImageIcon className="h-3.5 w-3.5" />}
                    label={startFrameLabel}
                    accept="image/jpeg,image/png,image/webp"
                    multiple={false}
                    group={startFrame}
                    disabled={loading}
                    bare
                  />
                )}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={loading}
                rows={3}
                placeholder={
                  skill
                    ? skill.promptPlaceholder || SKILL_PROMPT_FALLBACK
                    : AGENT_PLACEHOLDER
                }
                className="min-h-[64px] w-full resize-none bg-transparent text-base text-text-primary placeholder:text-text-disabled focus:outline-none"
              />
            </div>
            {(showScene || showCharacter) && (
              <div className="hidden shrink-0 items-start gap-3 lg:flex">
                {showScene && <UploadTile label="Scene" upload={scene} disabled={loading} />}
                {showCharacter && (
                  <UploadTile label="Character" upload={character} disabled={loading} />
                )}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-3 lg:mt-3 lg:flex-row lg:items-center lg:justify-between">
            <div className={STUDIO_CHIP_ROW_CLASS}>
              <SkillPicker
                value={skill?.title ?? "Skill"}
                activeId={skillId}
                onSelectSkill={selectSkill}
                onOpenHandoff={(href) => router.push(href)}
                disabled={loading}
              />
              {!isVideo && skill && (
                <>
                  <ChipDropdown
                    sheetTitle="Select image ratio"
                    square
                    showChevron={false}
                    icon={<Crop className="h-3.5 w-3.5" />}
                    value={aspectRatio}
                    activeId={aspectRatio}
                    options={PHOTO_ASPECT_RATIOS.map((a) => ({
                      id: a.id,
                      label: a.label,
                      hint: a.cinematic ? "Cinematic" : undefined,
                    }))}
                    onSelect={(id) => setAspectRatio(id as PhotoAspectRatio)}
                    disabled={loading}
                  />
                  {tier.hasResolution ? (
                    <ChipDropdown
                      sheetTitle="Select resolution"
                      square
                      showChevron={false}
                      icon={<Maximize2 className="h-3.5 w-3.5" />}
                      value={tier.resolutions.find((r) => r.id === resolution)?.label ?? "Res"}
                      activeId={resolution}
                      options={tier.resolutions.map((r) => ({
                        id: r.id,
                        label: r.label,
                        hint: `${imageCredits(r.pricingKey, 1)}`,
                      }))}
                      onSelect={(id) => setResolution(id as ProductPhotoResolution)}
                      disabled={loading}
                    />
                  ) : tier.fixedResolutionLabel ? (
                    <div
                      title="Output resolution (fixed for this model)"
                      className="flex h-10 shrink-0 cursor-default items-center gap-2 rounded-radius-sm bg-white/5 px-3 text-sm text-text-secondary"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                      {tier.fixedResolutionLabel}
                    </div>
                  ) : null}
                </>
              )}
              {isVideo && skill && (
                <>
                  <ChipDropdown
                    sheetTitle="Select clip length"
                    square
                    showChevron={false}
                    icon={<Clock className="h-3.5 w-3.5" />}
                    value={`${duration}s`}
                    activeId={String(duration)}
                    options={allowedDurations.map((d) => ({
                      id: String(d),
                      label: `${d}s`,
                      hint: `${videoCredits(videoPricingKey, d)}`,
                    }))}
                    onSelect={(id) => setDuration(Number(id))}
                    disabled={loading}
                  />
                  <ChipDropdown
                    sheetTitle="Select resolution"
                    square
                    showChevron={false}
                    icon={<Maximize2 className="h-3.5 w-3.5" />}
                    value={videoResolution}
                    activeId={videoResolution}
                    options={videoModel.resolutions.map((r) => ({
                      id: r,
                      label: r,
                      hint: `${videoCredits(
                        videoModel.pricingKey({
                          resolution: r,
                          generateAudio: videoModel.defaultGenerateAudio,
                        }),
                        duration
                      )}`,
                    }))}
                    onSelect={(id) => setVideoResolution(id as VideoResolution)}
                    disabled={loading}
                  />
                  <ChipDropdown
                    sheetTitle="Select video ratio"
                    square
                    showChevron={false}
                    icon={<Crop className="h-3.5 w-3.5" />}
                    value={videoAspect}
                    activeId={videoAspect}
                    options={videoModel.aspectRatios.map((a) => ({ id: a, label: a }))}
                    onSelect={(id) => setVideoAspect(id as VideoAspectRatio)}
                    disabled={loading}
                  />
                </>
              )}
            </div>

            <div className="hidden items-center gap-3 lg:flex">
              <CreditActionButton
                balance={balance}
                cost={cost}
                ready={canGenerate}
                loading={loading}
                label="Generate"
                className={`${GENERATE_BTN_CLASS} w-[172px]`}
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

        {!isVideo && skill ? (
          <StudioModelPanel>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-text-disabled">Model</span>
              <ChipDropdown
                sheetTitle="Select model"
                bare
                icon={<Cpu className="h-3.5 w-3.5" />}
                value={tier.modelLabel}
                activeId={modelTier}
                options={photoModelOptions}
                onSelect={(id) => setModelTier(id as ProductPhotoModelTier)}
                disabled={loading}
              />
            </div>
          </StudioModelPanel>
        ) : null}

            <div className="flex items-center gap-3 lg:hidden">
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

        {embed ? (
          <FeaturedSkillsRow
            activeSkillId={skillId}
            onSelectSkill={selectSkill}
            className="mt-4 hidden lg:flex"
          />
        ) : null}
      </StudioForm>

      {error && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-error/20 bg-error/10 p-4 text-sm text-error">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && skill && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-text-secondary">
          <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
          Generating with {isVideo ? videoModel.modelLabel : tier.modelLabel} — it will appear below
          when ready.
        </div>
      )}
    </>
  );
}

export default function SkillComposer({ embed = false }: { embed?: boolean }) {
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const onHistoryRefresh = useCallback(() => setHistoryRefreshKey((k) => k + 1), []);

  return (
    <SkillsCatalogProvider>
    <StudioGenerationPreviewProvider onHistoryChange={onHistoryRefresh}>
      <SkillOmniInner
        embed={embed}
        historyRefreshKey={historyRefreshKey}
        onHistoryRefresh={onHistoryRefresh}
      />
    </StudioGenerationPreviewProvider>
    </SkillsCatalogProvider>
  );
}
