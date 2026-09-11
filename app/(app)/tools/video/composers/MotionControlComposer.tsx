"use client";

import { useEffect, useMemo, useState } from "react";

import { AlertCircle, ChevronDown, Clock, Cpu, Film, Layers, Loader2, Maximize2, SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import {
  ChipDropdown,
  CreditActionButton,
  GENERATE_BTN_CLASS,
  GenerationCancelButton,
  DevBlankTestToggle,
  Tooltip,
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
import { parseStudioGenerationResponse } from "@/lib/studio-generation-response";

import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { usePricing } from "@/app/(app)/pricing-context";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { consumePendingDraft } from "@/lib/pending-form-draft";

import { useVideoDurationSec } from "@/lib/use-video-duration";
import { MOTION_CONTROL_MAX_RUNTIME_MS } from "@/lib/generation-workflows/motion-control-workflow-types";
import {
  MOTION_CONTROL_MODELS,
  getMotionControlModel,
  effectiveMotionControlDuration,
  motionControlRefVideoDurationError,
  formatMotionControlModelCreditHint,
  formatMotionClipDuration,
  motionControlPanelCaption,
  motionControlResolutionLabel,
  MOTION_CONTROL_QUALITY_TOOLTIP,
  motionControlVideoHint,
  MOTION_CONTROL_PROMPT_PLACEHOLDER,
  motionControlSoundTooltip,
  DEFAULT_CHARACTER_ORIENTATION,
  type MotionControlModelId,
  type MotionControlMode,
} from "@/lib/motion-control-models";
import {
  filterEnabledCatalog,
  snapToEnabledModel,
  type VideoComposerKey,
  type VideoComposerEnablement,
} from "@/lib/video-composer-features";
import { motionControlGenerationVideoUrl } from "@/lib/trending-templates";
import {
  CharacterPicker,
  creationTypeChipOptions,
  MC_VIDEO_ACCEPT,
} from "./shared";
import type { CharacterSource, LibraryCharacter, VideoCreationTypeOption } from "./types";

async function pollMotionControlResult(idempotencyKey: string): Promise<{
  videoUrl?: string;
  storagePath?: string;
  historyItem?: { storagePath?: string } | null;
}> {
  const pollMs = 3000;
  // The composer must never give up before the durable run itself does.
  const maxAttempts = Math.ceil(MOTION_CONTROL_MAX_RUNTIME_MS / pollMs);
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, pollMs));
    const res = await fetch("/api/generate-motion-control/status", {
      headers: { "Idempotency-Key": idempotencyKey },
    });
    const data = await parseStudioGenerationResponse(res);
    if (res.ok && data.videoUrl) {
      return data as {
        videoUrl?: string;
        storagePath?: string;
        historyItem?: { storagePath?: string } | null;
      };
    }
    if (res.status === 202) continue;
    if (data.code === "GENERATION_CANCELLED") {
      throw Object.assign(new Error("Generation cancelled."), { code: "GENERATION_CANCELLED" });
    }
    throw new Error(data.error || data.message || "Generation failed");
  }
  throw new Error("Generation is taking longer than expected. Check your history shortly.");
}

export default function MotionControlComposer({
  initialTemplateVideo,
  creationTypes,
  isAdmin,
  devBlank,
  onDevBlankChange,
  composerEnablement,
  onSelectCreation,
  onGenerated,
}: {
  initialTemplateVideo?: string | null;
  creationTypes: VideoCreationTypeOption[];
  isAdmin: boolean;
  devBlank: boolean;
  onDevBlankChange: (next: boolean) => void;
  composerEnablement: Record<VideoComposerKey, VideoComposerEnablement> | null;
  onSelectCreation: (id: string) => void;
  onGenerated: () => void;
}) {
  const { openPreviewFromResponse } = useStudioGenerationPreview();
  const motionControlModels = filterEnabledCatalog(
    MOTION_CONTROL_MODELS,
    "motion_control",
    composerEnablement
  );
  const [modelId, setModelId] = useState<MotionControlModelId>(MOTION_CONTROL_MODELS[0].id);
  const model = getMotionControlModel(modelId);

  useEffect(() => {
    if (motionControlModels.length === 0) return;
    const next = snapToEnabledModel(
      modelId,
      motionControlModels,
      "motion_control",
      composerEnablement
    ) as MotionControlModelId;
    if (next !== modelId) setModelId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionControlModels.map((m) => m.id).join(","), composerEnablement]);

  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<MotionControlMode>(model.defaultMode);
  const [keepOriginalSound, setKeepOriginalSound] = useState<boolean>(
    model.defaultKeepOriginalSound
  );

  // Character source: upload your own, or pick one created in Photo → Character.
  const [charSource, setCharSource] = useState<CharacterSource>("upload");
  const [libraryChar, setLibraryChar] = useState<LibraryCharacter | null>(null);

  // The prompt is optional (Kling generates from just the image + motion video),
  // so it lives in a collapsed "Advanced" section to keep the form uncluttered.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);

  // Restore what was typed before a gated Generate click sent the visitor
  // through sign-in — see lib/pending-form-draft.ts.
  useEffect(() => {
    const draft = consumePendingDraft<{
      prompt?: string;
      mode?: MotionControlMode;
      keepOriginalSound?: boolean;
    }>(window.location.pathname);
    if (!draft) return;
    if (draft.prompt) setPrompt(draft.prompt);
    if (draft.mode) setMode(draft.mode);
    if (typeof draft.keepOriginalSound === "boolean") setKeepOriginalSound(draft.keepOriginalSound);
    // The character image and motion-reference video can't survive the round
    // trip (see lib/pending-form-draft.ts) — say so explicitly.
    setRestoreNotice("Signed in — your settings were saved. Please re-attach your character image and motion video if you'd uploaded them.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { videoCredits } = usePricing();
  const { balance, refetch: refetchCredits } = useCreditBalance();
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const {
    loading,
    error,
    submit,
    cancel: cancelSubmit,
    cancelling,
    cancelAllowed,
  } = useStudioGenerationSubmit({
    refetchCredits,
    refreshHistory: onGenerated,
    openPreviewFromResponse,
  });

  const charImage = useMediaRefs("image", 1);
  const motionVideo = useMediaRefs("video", 1);

  // A "Trending template" deep-link (?templateVideo=<public url>) preloads a
  // hosted driving clip. It's a permanent public URL (path ""), so — like a
  // library character — it's never touched by the temp-upload sweep. When set,
  // it takes the place of an uploaded motion video.
  const [templateUrl, setTemplateUrl] = useState<string | null>(
    initialTemplateVideo ?? null
  );

  const motionFile = motionVideo.items[0]?.file ?? null;
  const motionObjectUrl = useMemo(
    () => (motionFile ? URL.createObjectURL(motionFile) : null),
    [motionFile]
  );
  useEffect(() => {
    return () => {
      if (motionObjectUrl) URL.revokeObjectURL(motionObjectUrl);
    };
  }, [motionObjectUrl]);

  // Uploaded file wins over a preloaded template. Duration drives billing.
  const motionVideoSrc = motionObjectUrl ?? templateUrl;
  const {
    durationSec: videoDurationSec,
    measuring: durationMeasuring,
    failed: durationProbeFailed,
  } = useVideoDurationSec(motionVideoSrc);

  const billedDuration = effectiveMotionControlDuration({
    model,
    refVideoDurationSec: videoDurationSec,
  });
  const qualityLabel = `${mode === "std" ? "Standard" : "Pro"} · ${motionControlResolutionLabel(mode)}`;
  const pricingKey = model.pricingKey(mode);
  const cost = devBlank ? 0 : videoCredits(pricingKey, billedDuration);
  const motionPanelCaption = motionControlPanelCaption({
    refDurationSec: videoDurationSec,
    billedDurationSec: billedDuration,
    costCredits: cost,
    measuring: durationMeasuring,
    probeFailed: durationProbeFailed,
    qualityLabel,
  });
  const modelCreditDuration = videoDurationSec != null ? billedDuration : undefined;

  // Resolve the character image from whichever source is active. Library characters
  // are resolved server-side via characterCreationId (pipeline-signed URL).
  const resolvedCharacter: { url: string; path: string } | null =
    charSource === "upload" && charImage.done[0]
      ? { url: charImage.done[0].url, path: charImage.done[0].path }
      : null;

  // The driving video comes from a preloaded template (hosted URL) or an upload.
  // Template preview may be webm; generation always uses the catalog MP4 mapping.
  const resolvedVideo: { url: string; path: string } | null = templateUrl
    ? { url: motionControlGenerationVideoUrl(templateUrl), path: "" }
    : motionVideo.done[0]
      ? { url: motionVideo.done[0].url, path: motionVideo.done[0].path }
      : null;

  const imageReady =
    charSource === "library" ? libraryChar !== null : resolvedCharacter !== null;
  const videoReady = resolvedVideo !== null;
  const anyUploading =
    motionVideo.uploading || (charSource === "upload" && charImage.uploading);
  const durationError = motionControlRefVideoDurationError(videoDurationSec);
  const durationReady =
    !durationMeasuring && (videoDurationSec != null || durationProbeFailed);
  const canGenerate =
    !loading && !anyUploading && imageReady && videoReady && durationReady && !durationError;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate) return;
    if (status !== "authenticated") {
      openSignInModal(undefined, { prompt, mode, keepOriginalSound });
      return;
    }

    const body = {
      modelId,
      prompt: prompt.trim(),
      mode,
      characterOrientation: DEFAULT_CHARACTER_ORIENTATION,
      keepOriginalSound,
      refVideoDurationSec: videoDurationSec,
      characterCreationId:
        charSource === "library" && libraryChar ? libraryChar.id : undefined,
      image: resolvedCharacter,
      video: resolvedVideo,
      ...(devBlank ? { devBlank: true } : {}),
    };

    await submit(JSON.stringify(body), (idempotencyKey) =>
      fetch("/api/generate-motion-control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      }),
      {
        fallbackCost: cost,
        awaitCompletion: (_initialData, key) => pollMotionControlResult(key),
        onSuccess: () => {
          charImage.reset();
          motionVideo.reset();
          setLibraryChar(null);
        },
      },
    );
  };

  return (
    <>
      <StudioForm mode="video" onSubmit={handleGenerate}>
        {/* Top-left chips: creation type + model */}
        <StudioFormHeader>
          <ChipDropdown
            sheetTitle="Select creation type"
            icon={<Layers className="h-3.5 w-3.5" />}
            value="Motion control"
            activeId="motion_control"
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
              options={motionControlModels.map((m) => ({
                id: m.id,
                label: m.modelLabel,
                hint: formatMotionControlModelCreditHint(m, videoCredits, modelCreditDuration),
              }))}
              onSelect={(id) => setModelId(id as MotionControlModelId)}
              disabled={loading}
            />
          </div>
        </StudioFormHeader>

        <StudioFormCard>
          {/* Uploads: character image + motion video (both required) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CharacterPicker
              group={charImage}
              source={charSource}
              onSourceChange={setCharSource}
              selected={libraryChar}
              onSelect={setLibraryChar}
              disabled={loading}
            />
            {templateUrl ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                    <span className="text-text-secondary">
                      <Film className="h-3.5 w-3.5" />
                    </span>
                    Motion to copy
                    <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-N700">
                      template
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTemplateUrl(null)}
                    disabled={loading}
                    className="text-[10px] font-semibold text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
                  >
                    Use my own
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-radius-sm border border-white/10 bg-N0/40">
                    <video
                      src={templateUrl}
                      muted
                      loop
                      playsInline
                      autoPlay
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                    {videoDurationSec != null && !durationMeasuring ? (
                      <span className="absolute bottom-1 right-1 rounded bg-N0/80 px-1 py-0.5 text-[10px] font-semibold tabular-nums text-N900">
                        {formatMotionClipDuration(videoDurationSec)}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] leading-snug text-text-secondary">{motionPanelCaption}</p>
                </div>
              </div>
            ) : (
              <div>
                <RefGroup
                  icon={<Film className="h-3.5 w-3.5" />}
                  label="Motion to copy"
                  accept={MC_VIDEO_ACCEPT}
                  multiple={false}
                  group={motionVideo}
                  disabled={loading}
                  hint={motionControlVideoHint()}
                />
                {motionVideo.items.length > 0 ? (
                  <p className="mt-2 text-[11px] leading-snug text-text-secondary">
                    {motionPanelCaption}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          {durationError ? (
            <p className="mt-2 text-sm leading-snug text-warning/90">{durationError}</p>
          ) : null}

          {/* Advanced settings (collapsed by default). The prompt is optional —
              Kling generates from just the character image + motion video — so we
              tuck it away here. Motion still comes from the reference video; the
              prompt only adds background/scene details. */}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              aria-expanded={advancedOpen}
              className="flex items-center gap-1.5 text-sm font-semibold text-text-secondary transition-colors hover:text-N700"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-text-secondary" />
              Advanced settings
              {!advancedOpen && prompt.trim() && (
                <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-xs font-medium text-N700">
                  prompt added
                </span>
              )}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              />
            </button>
            {advancedOpen && (
              <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-sm font-semibold text-N700">Prompt</span>
                  <span className="text-sm font-medium text-text-disabled">optional</span>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  maxLength={model.promptMaxChars}
                  placeholder={MOTION_CONTROL_PROMPT_PLACEHOLDER}
                  rows={3}
                  className="min-h-[64px] w-full resize-none bg-transparent text-base text-text-primary placeholder:text-text-disabled focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Controls row */}
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className={STUDIO_CHIP_ROW_CLASS}>
              {videoReady ? (
                <div
                  className="flex h-10 items-center gap-2 rounded-radius-sm bg-white/5 px-3 text-sm text-text-secondary"
                  title="Output length follows your motion clip; credits scale with billed seconds."
                >
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span className="tabular-nums">
                    {durationMeasuring
                      ? "Measuring clip…"
                      : videoDurationSec != null
                        ? `${formatMotionClipDuration(videoDurationSec)} · ${cost} cr`
                        : durationProbeFailed
                          ? `~${billedDuration}s est. · ${cost} cr`
                          : "—"}
                  </span>
                </div>
              ) : null}
              <ChipDropdown
                sheetTitle="Select quality"
                square
                showChevron={false}
                icon={<Maximize2 className="h-3.5 w-3.5" />}
                value={`${mode === "std" ? "Standard" : "Pro"} · ${motionControlResolutionLabel(mode)}`}
                activeId={mode}
                tooltip={MOTION_CONTROL_QUALITY_TOOLTIP}
                options={model.modes.map((m) => ({
                  id: m,
                  label: `${m === "std" ? "Standard" : "Pro"} · ${motionControlResolutionLabel(m)}`,
                  hint: `${videoCredits(model.pricingKey(m), billedDuration)}`,
                }))}
                onSelect={(id) => setMode(id as MotionControlMode)}
                disabled={loading}
              />
              <Tooltip
                className="flex-1 lg:flex-none"
                label={motionControlSoundTooltip(keepOriginalSound)}
              >
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setKeepOriginalSound((v) => !v)}
                  className={`flex h-10 w-full items-center justify-center gap-2 rounded-radius-sm px-3 text-sm transition-colors disabled:opacity-40 lg:w-auto lg:justify-start ${
                    keepOriginalSound
                      ? "bg-white/5 text-N700 hover:bg-white/10"
                      : "bg-white/5 text-text-disabled hover:bg-white/10 hover:text-text-secondary"
                  }`}
                >
                  {keepOriginalSound ? (
                    <Volume2 className="h-3.5 w-3.5 text-text-secondary" />
                  ) : (
                    <VolumeX className="h-3.5 w-3.5 text-text-disabled" />
                  )}
                  Original sound
                </button>
              </Tooltip>
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
              options={motionControlModels.map((m) => ({
                id: m.id,
                label: m.modelLabel,
                hint: formatMotionControlModelCreditHint(m, videoCredits, modelCreditDuration),
              }))}
              onSelect={(id) => setModelId(id as MotionControlModelId)}
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

      {error && (
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
          Generating with {model.modelLabel} — this can take a couple of minutes. It will appear below when ready.
        </div>
      )}

    </>
  );
}
