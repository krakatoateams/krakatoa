"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Cpu,
  Crop,
  ImageIcon,
  Info,
  Languages,
  Layers,
  Loader2,
  Maximize2,
  Pencil,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { TileSkeleton } from "@/components/ui/TileSkeleton";
import {
  ChipDropdown,
  CreditActionButton,
  GENERATE_BTN_CLASS,
  GenerationCancelButton,
  DevBlankTestToggle,
  Tooltip,
  STUDIO_CHIP_ROW_CLASS,
  StudioForm,
  StudioFormCard,
  StudioFormHeader,
  StudioModelPanel,
  useStudioGenerationPreview,
  uploadRefFile,
} from "@/components/studio";
import { useStudioGenerationSubmit } from "@/lib/studio-generation-submit";
import { STUDIO_GENERATION_RECOVERABLE_FALLBACK } from "@/lib/studio-generation-response";

import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { usePricing } from "@/app/(app)/pricing-context";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import {
  consumePendingDraftForOwner,
  hasPendingDraftForOwner,
} from "@/lib/pending-form-draft";
import {
  buildStoryboardImportPendingDraft,
  buildStoryboardVideoPendingDraft,
  createStoryboardImportPreparationGate,
  isStoryboardVideoReady,
  resolveLoadedStoryboardSelection,
  resolveStoryboardDraftValue,
  storyboardImportAttemptSignature,
  storyboardVideoAttemptSignature,
  VIDEO_COMPOSER_DRAFT_OWNER,
  type StoryboardImportPreparationGate,
  type StoryboardImportPendingDraft,
  type StoryboardVideoPendingDraft,
} from "@/lib/video-composer-attempt-contracts";

import {
  STORYBOARD_VIDEO_MODEL_IDS,
  DEFAULT_STORYBOARD_VIDEO_MODEL_ID,
  getVideoModel,
  formatVideoModelCreditHint,
  type StoryboardVideoModelId,
} from "@/lib/video-models";
import {
  resolveStoryboardAspectRatio,
  storyboardOrientationLabel,
  type StoryboardAspectRatio,
  STORYBOARD_ASPECT_RATIOS,
  DEFAULT_STORYBOARD_ASPECT_RATIO,
  STORYBOARD_LANGUAGES,
  DEFAULT_STORYBOARD_LANGUAGE,
  resolveStoryboardLanguage,
  storyboardLanguageLabel,
  type StoryboardLanguageId,
  STORYBOARD_STYLE_KEYS,
  STORYBOARD_STYLE_LABELS,
  DEFAULT_STORYBOARD_STYLE,
  type StoryboardStyleKey,
  SEEDANCE_PROMPT_BODY_BUDGET_CHARS,
} from "@/lib/storyboard-style";
import {
  filterEnabledCatalog,
  snapToEnabledModel,
  type VideoComposerKey,
  type VideoComposerEnablement,
} from "@/lib/video-composer-features";
import { creationTypeChipOptions, GenerationRecoverableBanner } from "./shared";
import type { StoryboardListItem, VideoCreationTypeOption } from "./types";

function storyboardVideoPricingKey(
  modelId: StoryboardVideoModelId,
  resolution: "480p" | "720p"
): string {
  return getVideoModel(modelId).pricingKey({ resolution, hasReferenceVideo: false });
}

const STORYBOARD_VIDEO_DURATION_SEC = 15;

function ImportStoryboardModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (item: StoryboardListItem) => void;
}) {
  const { imageCredits } = usePricing();
  const { balance, refetch: refetchCredits } = useCreditBalance();
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [aspect, setAspect] = useState<StoryboardAspectRatio>(DEFAULT_STORYBOARD_ASPECT_RATIO);
  const [language, setLanguage] = useState<StoryboardLanguageId>(DEFAULT_STORYBOARD_LANGUAGE);
  const [style, setStyle] = useState<StoryboardStyleKey>(DEFAULT_STORYBOARD_STYLE);
  const [fileError, setFileError] = useState<string | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [preparingUpload, setPreparingUpload] = useState(false);
  const [preparingCancelRequested, setPreparingCancelRequested] = useState(false);
  const mountedRef = useRef(true);
  const preparationGateRef = useRef<StoryboardImportPreparationGate | null>(null);
  const uploadedFileRef = useRef<{
    file: File;
    promise: ReturnType<typeof uploadRefFile>;
  } | null>(null);
  const {
    loading: submitLoading,
    error: submitError,
    submit,
    cancel: cancelSubmit,
    cancelling,
    cancelAllowed,
  } = useStudioGenerationSubmit({
    idempotencyScope: "video:storyboard-import",
    refetchCredits,
    refreshHistory: () => {},
    openPreviewFromResponse: () => {},
  });
  const busy = preparingUpload || submitLoading;
  const error = submitError ?? fileError;

  const cost = imageCredits("storyboard_import_vision_per_image", 1);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      preparationGateRef.current?.cancel();
    };
  }, []);

  // Restore what was typed before a gated Analyze click sent the visitor
  // through sign-in — see lib/pending-form-draft.ts. The owner marker keeps
  // this modal's fields separate from the main storyboard-video form while
  // still allowing Google's pathname-based URL fallback to carry the draft.
  useEffect(() => {
    const draft = consumePendingDraftForOwner<StoryboardImportPendingDraft>(
      window.location.pathname,
      VIDEO_COMPOSER_DRAFT_OWNER.storyboardImport,
    );
    if (!draft) return;
    if (draft.description) setDescription(draft.description);
    if (draft.aspectRatio) setAspect(draft.aspectRatio);
    if (draft.language) setLanguage(draft.language);
    if (draft.storyboardStyle) setStyle(draft.storyboardStyle);
    // The image itself can't survive the round trip (see
    // lib/pending-form-draft.ts) — say so explicitly.
    setRestoreNotice("Signed in — your details were saved. Please re-select the storyboard image.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      setFileError("Please choose a JPG, PNG, or WebP image.");
      return;
    }
    setFileError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    uploadedFileRef.current = null;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const analyze = async () => {
    if (!file || busy) return;
    if (status !== "authenticated") {
      openSignInModal(undefined, buildStoryboardImportPendingDraft({
        description,
        aspectRatio: aspect,
        language,
        storyboardStyle: style,
      }));
      return;
    }
    const preparationGate = createStoryboardImportPreparationGate();
    preparationGateRef.current = preparationGate;
    setPreparingCancelRequested(false);
    setPreparingUpload(true);
    let pendingUpload = uploadedFileRef.current;
    if (!pendingUpload || pendingUpload.file !== file) {
      pendingUpload = { file, promise: uploadRefFile(file) };
      uploadedFileRef.current = pendingUpload;
    }
    try {
      const { path } = await pendingUpload.promise;
      if (!preparationGate.canSubmit()) {
        if (uploadedFileRef.current === pendingUpload) uploadedFileRef.current = null;
        await fetch("/api/upload/ref/sign", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        }).catch(() => null);
        return;
      }
      if (mountedRef.current) setPreparingUpload(false);
      if (preparationGateRef.current === preparationGate) {
        preparationGateRef.current = null;
      }
      const requestBody = {
        imagePath: path,
        description: description.trim(),
        aspectRatio: aspect,
        language,
        storyboardStyle: style,
      };
      await submit(
        storyboardImportAttemptSignature(requestBody),
        (idempotencyKey) =>
          fetch("/api/storyboards/import", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify(requestBody),
          }),
        {
          fallbackCost: cost,
          errorFallback: "Couldn't import the storyboard.",
          unexpectedErrorFallback: "An unexpected error occurred.",
          skipSuccessEffects: true,
          onSuccess: (data) => {
            onImported({
              id: String(data.storyboardId),
              storyboardUrl: String(data.storyboardUrl),
              theme: description.trim() || "Imported storyboard",
              hasVideo: false,
              aspectRatio: resolveStoryboardAspectRatio(String(data.aspectRatio ?? "")),
              language: resolveStoryboardLanguage(String(data.language ?? "")),
              seedancePrompt: typeof data.seedancePrompt === "string" ? data.seedancePrompt : "",
              source: "uploaded",
            });
          },
        },
      );
    } catch (uploadError: unknown) {
      if (uploadedFileRef.current === pendingUpload) uploadedFileRef.current = null;
      if (preparationGate.canSubmit() && mountedRef.current) {
        setFileError(
          uploadError instanceof Error ? uploadError.message : "Couldn't upload the storyboard.",
        );
      }
    } finally {
      if (preparationGateRef.current === preparationGate) {
        preparationGateRef.current = null;
      }
      if (mountedRef.current) {
        setPreparingUpload(false);
        setPreparingCancelRequested(false);
      }
    }
  };

  const cancelImport = () => {
    if (preparingUpload) {
      preparationGateRef.current?.cancel();
      setPreparingCancelRequested(true);
      return;
    }
    void cancelSubmit();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-N0/70 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
      />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-N50 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-text-secondary" />
            <h3 className="text-sm font-bold text-N900">Upload your own storyboard</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1 text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
          {/* File picker / preview */}
          <label
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-6 text-center transition-colors ${
              previewUrl ? "border-white/15 bg-N0/30" : "border-white/20 hover:border-white/30"
            } ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Storyboard preview"
                className="max-h-48 w-auto rounded-lg border border-white/10 object-contain"
              />
            ) : (
              <>
                <Upload className="h-6 w-6 text-text-secondary" />
                <span className="text-sm text-text-secondary">Click to choose an image</span>
                <span className="text-sm text-text-disabled">JPG / PNG / WebP · up to 100 MB</span>
              </>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={busy}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {previewUrl && (
              <span className="text-sm font-semibold text-text-secondary">Change image</span>
            )}
          </label>

          {/* Optional description */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs sm:text-sm font-semibold uppercase tracking-wider text-text-secondary">
              Description <span className="text-text-disabled">(optional)</span>
              <Tooltip label="Briefly describe what should happen in the video. Helps the AI analyze your storyboard image.">
                <Info
                  className="h-3.5 w-3.5 text-text-disabled transition-colors hover:text-text-secondary"
                  aria-label="What the description is for"
                />
              </Tooltip>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              disabled={busy}
              placeholder="What should happen in the video? Helps steer the analysis."
              className="w-full resize-none rounded-xl border border-white/10 bg-N0/30 p-3 text-sm text-text-primary placeholder:text-text-disabled focus:border-white/25 focus:outline-none"
            />
          </div>

          {/* Orientation / language / style */}
          <div className={STUDIO_CHIP_ROW_CLASS}>
            <ChipDropdown
              sheetTitle="Select video ratio"
              square
              showChevron={false}
              icon={<Crop className="h-3.5 w-3.5" />}
              value={aspect}
              activeId={aspect}
              tooltip="Orientation of the video you'll render from this storyboard."
              options={STORYBOARD_ASPECT_RATIOS.map((a) => ({
                id: a,
                label: a,
                hint: storyboardOrientationLabel(a),
              }))}
              onSelect={(id) => setAspect(id as StoryboardAspectRatio)}
              disabled={busy}
            />
            <ChipDropdown
              sheetTitle="Select language"
              square
              showChevron={false}
              icon={<Languages className="h-3.5 w-3.5" />}
              value={storyboardLanguageLabel(language)}
              activeId={language}
              tooltip="Spoken language for the video's dialogue."
              options={STORYBOARD_LANGUAGES.map((l) => ({ id: l.id, label: l.label }))}
              onSelect={(id) => setLanguage(id as StoryboardLanguageId)}
              disabled={busy}
            />
            <ChipDropdown
              sheetTitle="Select style"
              square
              showChevron={false}
              icon={<Sparkles className="h-3.5 w-3.5" />}
              value={style === DEFAULT_STORYBOARD_STYLE ? "Style" : STORYBOARD_STYLE_LABELS[style]}
              activeId={style}
              dimValue={style === DEFAULT_STORYBOARD_STYLE}
              tooltip="Visual style baked into the generated video prompt."
              options={STORYBOARD_STYLE_KEYS.map((k) => ({
                id: k,
                label: STORYBOARD_STYLE_LABELS[k],
              }))}
              onSelect={(id) => setStyle(id as StoryboardStyleKey)}
              disabled={busy}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-error/20 bg-error/10 p-3 text-sm text-error">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {restoreNotice && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/20 bg-warning/10 p-3 text-sm text-warning">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{restoreNotice}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/10 px-5 py-4">
          <p className="mr-auto hidden text-sm text-text-disabled sm:block">
            We analyze the image to write the video prompt — you can edit it before rendering.
          </p>
          <GenerationCancelButton
            visible={busy}
            cancelling={cancelling || preparingCancelRequested}
            cancelAllowed={preparingUpload || cancelAllowed}
            onCancel={cancelImport}
          />
          <CreditActionButton
            type="button"
            onClick={analyze}
            balance={balance}
            cost={cost}
            ready={!!file}
            loading={busy}
            label="Analyze"
            className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-radius-sm bg-gradient-to-r from-brand-primary-light to-brand-primary px-5 text-sm font-bold uppercase tracking-wide text-text-on-solid shadow-lg shadow-brand-primary/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
      </div>
    </div>
  );
}


export default function StoryboardToVideoComposer({
  initialStoryboardId,
  creationTypes,
  isAdmin,
  devBlank,
  onDevBlankChange,
  composerEnablement,
  onSelectCreation,
  onGenerated,
}: {
  initialStoryboardId: string | null;
  creationTypes: VideoCreationTypeOption[];
  isAdmin: boolean;
  devBlank: boolean;
  onDevBlankChange: (next: boolean) => void;
  composerEnablement: Record<VideoComposerKey, VideoComposerEnablement> | null;
  onSelectCreation: (id: string) => void;
  onGenerated: () => void;
}) {
  const { openPreviewFromResponse } = useStudioGenerationPreview();
  const storyboardModels = filterEnabledCatalog(
    STORYBOARD_VIDEO_MODEL_IDS.map((id) => getVideoModel(id)),
    "storyboard",
    composerEnablement
  );
  const { videoCredits } = usePricing();
  const { balance, refetch: refetchCredits } = useCreditBalance();
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();

  const [items, setItems] = useState<StoryboardListItem[]>([]);
  const [listState, setListState] = useState<"loading" | "loaded" | "error">("loading");
  const [selectedId, setSelectedId] = useState<string | null>(initialStoryboardId);
  const requestedStoryboardIdRef = useRef<string | null>(initialStoryboardId);
  const [videoModelId, setVideoModelId] = useState<StoryboardVideoModelId>(
    DEFAULT_STORYBOARD_VIDEO_MODEL_ID
  );

  useEffect(() => {
    if (storyboardModels.length === 0) return;
    const next = snapToEnabledModel(
      videoModelId,
      storyboardModels,
      "storyboard",
      composerEnablement
    ) as StoryboardVideoModelId;
    if (next !== videoModelId) setVideoModelId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyboardModels.map((m) => m.id).join(","), composerEnablement]);
  const [resolution, setResolution] = useState<"480p" | "720p">("480p");
  // Aspect mirrors the selected storyboard's stored orientation (locked) so the
  // clip never flips. Only editable for legacy storyboards that have no ratio.
  const [aspect, setAspect] = useState<StoryboardAspectRatio>("16:9");
  // Language defaults to the storyboard's language but stays EDITABLE — the user
  // can re-voice the same storyboard in another language at video time.
  const [language, setLanguage] = useState<StoryboardLanguageId>(DEFAULT_STORYBOARD_LANGUAGE);
  const pendingPromptDraftRef = useRef<StoryboardVideoPendingDraft | null>(null);

  useEffect(() => {
    const draft = consumePendingDraftForOwner<StoryboardVideoPendingDraft>(
      window.location.pathname,
      VIDEO_COMPOSER_DRAFT_OWNER.storyboardVideo,
    );
    if (!draft) return;
    pendingPromptDraftRef.current = draft;
    if (draft.selectedId) {
      requestedStoryboardIdRef.current = draft.selectedId;
      setSelectedId(draft.selectedId);
    }
    if (STORYBOARD_VIDEO_MODEL_IDS.some((id) => id === draft.videoModelId)) {
      setVideoModelId(draft.videoModelId);
    }
    if (draft.resolution === "480p" || draft.resolution === "720p") {
      setResolution(draft.resolution);
    }
    setAspect(resolveStoryboardAspectRatio(draft.aspectRatio));
    setLanguage(resolveStoryboardLanguage(draft.language));
    onDevBlankChange(draft.devBlank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    idempotencyScope: "video:storyboard-to-video",
    refetchCredits,
    refreshHistory: onGenerated,
    openPreviewFromResponse,
  });
  // "Upload your own storyboard" modal. Opens after mount if an owner-scoped
  // draft says a gated Analyze click sent the visitor through sign-in while
  // this modal was open. Don't read browser state during
  // useState init: server HTML would be closed, the client would open, and
  // React hydrates with "Text content does not match server-rendered HTML".
  const [showUpload, setShowUpload] = useState(false);
  useEffect(() => {
    if (
      hasPendingDraftForOwner(
        window.location.pathname,
        VIDEO_COMPOSER_DRAFT_OWNER.storyboardImport,
      )
    ) {
      setShowUpload(true);
    }
  }, []);
  // Advanced: review/edit the Seedance prompt before rendering. Draft is synced
  // to the selected storyboard; only sent (and persisted) when actually changed.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");

  // Load the user's saved storyboards once. Auto-select the deep-linked one (from
  // Photo's "Create video" CTA), otherwise leave selection to the user.
  useEffect(() => {
    let cancelled = false;
    setListState("loading");
    fetch("/api/storyboards")
      .then((r) => r.json())
      .then((d: { storyboards?: Array<Record<string, unknown>> }) => {
        if (cancelled) return;
        const list: StoryboardListItem[] = (d.storyboards ?? [])
          .filter((s) => typeof s.storyboard_url === "string" && s.storyboard_url)
          .map((s) => ({
            id: String(s.id),
            storyboardUrl: String(s.storyboard_url),
            theme: typeof s.theme === "string" ? s.theme : "Storyboard",
            hasVideo: typeof s.video_url === "string" && !!s.video_url,
            aspectRatio:
              typeof s.aspect_ratio === "string"
                ? resolveStoryboardAspectRatio(s.aspect_ratio)
                : null,
            language:
              typeof s.language === "string"
                ? resolveStoryboardLanguage(s.language)
                : null,
            seedancePrompt:
              typeof s.seedance_prompt === "string" ? s.seedance_prompt : "",
            source: typeof s.source === "string" ? s.source : null,
          }));
        setItems(list);
        setListState("loaded");
        setSelectedId((cur) =>
          resolveLoadedStoryboardSelection({
            currentId: cur,
            requestedId: requestedStoryboardIdRef.current,
            availableIds: list.map((s) => s.id),
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setListState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const storyboardVideoModel = getVideoModel(videoModelId);
  const pricingKey = storyboardVideoPricingKey(videoModelId, resolution);
  const cost = devBlank ? 0 : videoCredits(pricingKey, STORYBOARD_VIDEO_DURATION_SEC);
  const selected = items.find((s) => s.id === selectedId) ?? null;
  const selectedLoaded = selected !== null;
  const canGenerate = isStoryboardVideoReady({ loading, selectedLoaded });
  const selectedLanguage = selected?.language ?? DEFAULT_STORYBOARD_LANGUAGE;
  const storedPrompt = selected?.seedancePrompt ?? "";
  // When the selected storyboard carries an orientation, the video MUST match it
  // (lock the chip). Legacy boards without one let the user choose.
  const aspectLocked = !!selected?.aspectRatio;

  useEffect(() => {
    if (selected?.aspectRatio) setAspect(selected.aspectRatio);
  }, [selected?.aspectRatio]);

  // Sync language to the selected storyboard (default English) whenever the
  // selection or its stored language changes. Manual overrides persist until the
  // board changes again, since neither dependency moves on a user edit.
  useEffect(() => {
    const pending = pendingPromptDraftRef.current;
    const resolved = resolveStoryboardDraftValue({
      draftSelectedId: pending?.selectedId ?? null,
      selectedId,
      selectedLoaded,
      draftValue: pending?.language ?? DEFAULT_STORYBOARD_LANGUAGE,
      storedValue: selectedLanguage,
    });
    if (resolved.kind === "value") setLanguage(resolved.value);
  }, [selectedId, selectedLanguage, selectedLoaded]);

  // Reset the editable prompt draft to the selected storyboard's stored prompt
  // when the selection changes (keyed on id so a user edit isn't clobbered).
  useEffect(() => {
    const pending = pendingPromptDraftRef.current;
    const resolved = resolveStoryboardDraftValue({
      draftSelectedId: pending?.selectedId ?? null,
      selectedId,
      selectedLoaded,
      draftValue: pending?.promptDraft ?? "",
      storedValue: storedPrompt,
    });
    if (resolved.kind === "wait") return;
    if (pending && (resolved.consumeDraft || listState === "loaded")) {
      pendingPromptDraftRef.current = null;
    }
    setPromptDraft(resolved.value);
  }, [listState, selectedId, selectedLoaded, storedPrompt]);

  const promptDirty = !!selectedId && promptDraft.trim() !== storedPrompt.trim() && promptDraft.trim().length > 0;

  // Splice a freshly imported storyboard into the list and select it.
  const handleImported = (item: StoryboardListItem) => {
    setItems((cur) => [item, ...cur.filter((s) => s.id !== item.id)]);
    setSelectedId(item.id);
    setShowUpload(false);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate || !selectedId) return;
    if (status !== "authenticated") {
      openSignInModal(undefined, buildStoryboardVideoPendingDraft({
        selectedId,
        videoModelId,
        resolution,
        aspectRatio: aspect,
        language,
        promptDraft,
        devBlank,
      }));
      return;
    }

    const editedPrompt = promptDirty ? promptDraft.trim() : undefined;
    const signature = storyboardVideoAttemptSignature({
      storyboardId: selectedId,
      videoModelId,
      resolution,
      aspectRatio: aspect,
      language,
      promptOverride: editedPrompt ?? null,
      devBlank,
    });
    await submit(signature, (idempotencyKey) =>
      fetch("/api/generate-storyboard-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          storyboardId: selectedId,
          videoModelId,
          resolution,
          aspectRatio: aspect,
          language,
          ...(editedPrompt ? { seedancePrompt: editedPrompt } : {}),
          ...(devBlank ? { devBlank: true } : {}),
        }),
      }),
      {
        fallbackCost: cost,
        onSuccess: () => {
          if (editedPrompt) {
            setItems((cur) =>
              cur.map((s) => (s.id === selectedId ? { ...s, seedancePrompt: editedPrompt } : s)),
            );
          }
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
            value="Storyboard to video"
            activeId="storyboard"
            options={creationTypeChipOptions(creationTypes, isAdmin)}
            onSelect={onSelectCreation}
            disabled={loading}
          />
          {/* Model chip stays inline in the top row on desktop only */}
          <div className="hidden lg:block">
            <ChipDropdown
              sheetTitle="Select model"
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={storyboardVideoModel.modelLabel}
              activeId={videoModelId}
              options={storyboardModels.map((m) => ({
                id: m.id,
                label: m.modelLabel,
                hint: formatVideoModelCreditHint(m, videoCredits, STORYBOARD_VIDEO_DURATION_SEC),
              }))}
              onSelect={(id) => setVideoModelId(id as StoryboardVideoModelId)}
              disabled={loading}
            />
          </div>
        </StudioFormHeader>

        <StudioFormCard>
          {/* Storyboard picker */}
          <div className="mb-1 flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold uppercase tracking-wider text-text-secondary">
              <span className="text-text-secondary">
                <ImageIcon className="h-3.5 w-3.5" />
              </span>
              Choose a storyboard
              <Tooltip label="Pick a storyboard from Photo Studio or upload your own image. The AI turns it into a 15s video with dialogue.">
                <Info
                  className="h-3.5 w-3.5 text-text-disabled transition-colors hover:text-text-secondary"
                  aria-label="How storyboard selection works"
                />
              </Tooltip>
            </span>
          </div>

          {listState === "loading" ? (
            <TileSkeleton
              count={3}
              gridClassName="grid grid-cols-2 gap-3 sm:grid-cols-3"
              aspectClassName="aspect-[3/2]"
              label="Loading your storyboards"
            />
          ) : listState === "error" ? (
            <div className="flex h-24 items-center gap-2 text-sm text-error">
              <AlertCircle className="h-4 w-4" /> Couldn&apos;t load your storyboards.
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1 text-sm text-text-disabled">
                <span>You don&apos;t have any storyboards yet.</span>
                <a
                  href="/tools/photo-v2?type=storyboard"
                  className="font-semibold text-text-secondary hover:text-N700"
                >
                  Create one in Photo → Storyboard →
                </a>
              </div>
              <button
                type="button"
                disabled={loading}
                onClick={() => setShowUpload(true)}
                className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-4 py-3 text-sm font-semibold text-text-secondary transition-colors hover:border-white/30 hover:text-text-primary disabled:opacity-40"
              >
                <Upload className="h-4 w-4" />
                Upload your own storyboard
              </button>
            </div>
          ) : (
            <div className="grid max-h-[320px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
              <button
                type="button"
                disabled={loading}
                onClick={() => setShowUpload(true)}
                className="flex h-full min-h-[108px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/20 bg-white/[0.02] text-text-secondary transition-colors hover:border-white/30 hover:text-text-primary disabled:opacity-40"
              >
                <Upload className="h-5 w-5" />
                <span className="text-sm font-semibold">Upload your own</span>
              </button>
              {items.map((s) => {
                const active = s.id === selectedId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={loading}
                    onClick={() => setSelectedId(s.id)}
                    title={s.theme}
                    className={`group relative overflow-hidden rounded-xl border text-left transition-colors disabled:opacity-40 ${
                      active
                        ? "border-white/40 ring-2 ring-white/25"
                        : "border-white/10 hover:border-white/30"
                    }`}
                  >
                    <div className="relative aspect-[3/2] w-full">
                      <Image
                        src={s.storyboardUrl}
                        alt={s.theme}
                        fill
                        sizes="(min-width: 640px) 220px, 45vw"
                        className="object-cover"
                      />
                    </div>
                    <span className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-text-secondary">
                      {s.aspectRatio && (
                        <span className="shrink-0 rounded bg-white/10 px-1 py-0.5 text-xs font-semibold text-N700">
                          {s.aspectRatio}
                        </span>
                      )}
                      <span className="truncate">{s.theme}</span>
                    </span>
                    {s.hasVideo && (
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-N0/70 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-success">
                        Has video
                      </span>
                    )}
                    {s.source === "uploaded" && (
                      <span className="absolute left-1.5 bottom-9 rounded-full bg-N0/70 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                        Uploaded
                      </span>
                    )}
                    {active && (
                      <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-N900 text-N0">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Controls row */}
          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className={STUDIO_CHIP_ROW_CLASS}>
              <ChipDropdown
                sheetTitle="Select resolution"
                square
                showChevron={false}
                icon={<Maximize2 className="h-3.5 w-3.5" />}
                value={resolution}
                activeId={resolution}
                tooltip="Video resolution. 720p is crisper but costs more credits. Clips are 15s."
                options={(["480p", "720p"] as const).map((r) => ({
                  id: r,
                  label: r,
                  hint: `${videoCredits(storyboardVideoPricingKey(videoModelId, r), STORYBOARD_VIDEO_DURATION_SEC)}`,
                }))}
                onSelect={(id) => setResolution(id as "480p" | "720p")}
                disabled={loading}
              />
              <ChipDropdown
                sheetTitle="Select video ratio"
                square
                showChevron={!aspectLocked}
                icon={<Crop className="h-3.5 w-3.5" />}
                value={aspect}
                activeId={aspect}
                tooltip={
                  aspectLocked
                    ? "Locked to your storyboard's orientation so the video can't flip vertical/horizontal."
                    : "Output orientation for this clip."
                }
                options={(["16:9", "9:16"] as const).map((a) => ({
                  id: a,
                  label: a,
                  hint: storyboardOrientationLabel(a),
                }))}
                onSelect={(id) => setAspect(id as StoryboardAspectRatio)}
                disabled={loading || aspectLocked}
              />
              <ChipDropdown
                sheetTitle="Select language"
                square
                showChevron={false}
                icon={<Languages className="h-3.5 w-3.5" />}
                value={storyboardLanguageLabel(language)}
                activeId={language}
                tooltip="Spoken language for the video's dialogue. Defaults to the storyboard's language — change it to re-voice this storyboard in another language."
                options={STORYBOARD_LANGUAGES.map((l) => ({
                  id: l.id,
                  label: l.label,
                }))}
                onSelect={(id) => setLanguage(id as StoryboardLanguageId)}
                disabled={loading}
              />
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
                label="Create video"
              />
              <GenerationCancelButton
                visible={loading}
                cancelling={cancelling}
                cancelAllowed={cancelAllowed}
                onCancel={() => cancelSubmit()}
              />
            </div>
          </div>

          {/* Advanced: review / edit the Seedance prompt before rendering. */}
          {selectedId ? (
            <div className="mt-4 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                className="flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-text-secondary transition-colors hover:text-N700 sm:text-sm"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                />
                <Pencil className="h-3.5 w-3.5 text-text-secondary" />
                Advanced — edit prompt
                {promptDirty && (
                  <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-xs font-bold text-N700">
                    Edited
                  </span>
                )}
              </button>
              {advancedOpen && (
                <div className="mt-3">
                  <textarea
                    value={promptDraft}
                    onChange={(e) => setPromptDraft(e.target.value)}
                    rows={6}
                    disabled={loading}
                    placeholder="The video prompt Seedance will follow…"
                    className="w-full resize-y rounded-xl border border-white/10 bg-N0/30 p-3 text-sm leading-relaxed text-N700 placeholder:text-text-disabled focus:border-white/25 focus:outline-none"
                  />
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-sm text-text-disabled">
                    <span>
                      Style, orientation &amp; language are re-applied automatically on render.
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={
                          promptDraft.length > SEEDANCE_PROMPT_BODY_BUDGET_CHARS
                            ? "font-semibold text-warning"
                            : "text-text-disabled"
                        }
                        title={`Keep the prompt under ~${SEEDANCE_PROMPT_BODY_BUDGET_CHARS} characters so style, orientation & language can be added without the video model truncating it.`}
                      >
                        {promptDraft.length}/{SEEDANCE_PROMPT_BODY_BUDGET_CHARS}
                      </span>
                      {promptDirty && (
                        <button
                          type="button"
                          onClick={() => setPromptDraft(storedPrompt)}
                          className="font-semibold text-text-secondary hover:text-N700"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                  {promptDraft.length > SEEDANCE_PROMPT_BODY_BUDGET_CHARS && (
                    <p className="mt-1 text-sm text-warning/80">
                      This prompt is long — it may be trimmed at a sentence boundary on render so the style, orientation &amp; language directives still fit. Shorten it for full fidelity.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {!selectedId && listState === "loaded" && items.length > 0 ? (
            <p className="mt-3 pl-1 text-sm text-warning/80">
              Pick a storyboard to turn into a video.
            </p>
          ) : null}
        </StudioFormCard>

        {/* Model — attached under the form card on mobile only */}
        <StudioModelPanel>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-text-disabled">Model</span>
            <ChipDropdown
              sheetTitle="Select model"
              bare
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={storyboardVideoModel.modelLabel}
              activeId={videoModelId}
              options={storyboardModels.map((m) => ({
                id: m.id,
                label: m.modelLabel,
                hint: formatVideoModelCreditHint(m, videoCredits, STORYBOARD_VIDEO_DURATION_SEC),
              }))}
              onSelect={(id) => setVideoModelId(id as StoryboardVideoModelId)}
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
              label="Create video"
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

      {showUpload && (
        <ImportStoryboardModal
          onClose={() => setShowUpload(false)}
          onImported={handleImported}
        />
      )}

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
          Rendering your storyboard into a 15s clip — it will appear below when ready.
        </div>
      )}

    </>
  );
}
