"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Loader2,
  AlertCircle,
  Check,
  ChevronDown,
  Layers,
  Cpu,
  Crop,
  Maximize2,
  Clock,
  Volume2,
  VolumeX,
  Music,
  Film,
  ImageIcon,
  X,
  Sparkles,
  Repeat,
  UserRound,
  SlidersHorizontal,
  Languages,
  Upload,
  Pencil,
  Mic,
  Smile,
  CalendarClock,
  Download,
  Type,
  Minus,
} from "lucide-react";
import CreationsHistory from "@/components/CreationsHistory";
import MentionTextarea from "@/components/MentionTextarea";
import PhotoLibraryPicker, {
  type LibraryImage,
  type PhotoLibrarySource,
} from "@/components/PhotoLibraryPicker";
import type { CreationHistoryItem } from "@/lib/creations";
import { parseMentionAssetsFromHistory, type MentionAsset } from "@/lib/mention-assets";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { usePricing } from "@/app/(app)/pricing-context";
import { pickGenerateStoragePath, useSignedMediaUrl } from "@/lib/use-signed-media-url";
import { useIdempotentSubmit } from "@/lib/use-idempotent-submit";
import {
  ChipDropdown,
  CreditActionButton,
  GENERATE_BTN_CLASS,
  CANCEL_BTN_CLASS,
  Tooltip,
  RefGroup,
  useMediaRefs,
  uploadRefFile,
  STUDIO_CHIP_ROW_CLASS,
  StudioModelPanel,
  type RefGroupApi,
} from "@/components/studio";
import {
  TEXT_TO_VIDEO_MODELS,
  IMAGE_TO_VIDEO_MODELS,
  DEFAULT_VIDEO_MODEL_ID,
  DEFAULT_IMAGE_TO_VIDEO_MODEL_ID,
  getVideoModel,
  getAllowedDurations,
  validateVideoReferences,
  STORYBOARD_VIDEO_MODEL_IDS,
  DEFAULT_STORYBOARD_VIDEO_MODEL_ID,
  allowsFrameWithReferenceImages,
  formatVideoModelCreditHint,
  type VideoModelId,
  type StoryboardVideoModelId,
  type VideoResolution,
  type VideoAspectRatio,
} from "@/lib/video-models";
import {
  MOTION_CONTROL_MODELS,
  getMotionControlModel,
  effectiveMotionControlDuration,
  formatMotionControlModelCreditHint,
  motionControlResolutionLabel,
  type MotionControlModelId,
  type MotionControlMode,
  type CharacterOrientation,
} from "@/lib/motion-control-models";
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
  reelsPricingKey,
  reelsTotalDurationSec,
  reelsEngineLabel,
  REELS_ENGINES,
  DEFAULT_VOICE_ID,
  type SeedanceResolution,
  type VeoResolution,
} from "@/lib/reels-models";
import type { ReelsEngine, ReelsVeoMode } from "@/lib/reels-pipeline/types";
import {
  composerHasEnabledModels,
  filterEnabledCatalog,
  filterReelsEngines,
  mapVideoComposerEnablement,
  snapToEnabledModel,
  type VideoComposerEnablement,
  type VideoComposerKey,
} from "@/lib/video-composer-features";

function describeIdempotencyError(
  status: number,
  data: { code?: string; error?: string }
): string | null {
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

async function loadMentionAssetsFromApi(): Promise<MentionAsset[]> {
  try {
    const res = await fetch(
      "/api/creations/history?tool=product_photo,storyboard&mediaType=image&limit=50"
    );
    const data = await res.json();
    return parseMentionAssetsFromHistory((data.items ?? []) as CreationHistoryItem[]);
  } catch {
    return [];
  }
}

// Creation types in the top-left chip. All four are now wired in-page.
const CREATION_TYPES = [
  { id: "text2video", label: "Text to video", available: true },
  { id: "image2video", label: "Image to video", available: true },
  { id: "motion_control", label: "Motion control", available: true },
  { id: "storyboard", label: "Storyboard to video", available: true },
  { id: "reels-creator", label: "Reels Creator", available: true },
] as const;

type VideoCreationTypeOption = (typeof CREATION_TYPES)[number];

type VideoCreationType =
  | "text2video"
  | "image2video"
  | "motion_control"
  | "storyboard"
  | "reels-creator";

// Motion Control character source: an uploaded file, or one previously created
// in Photo → Character (stored as a product_photo creation, kind "character").
type CharacterSource = "upload" | "library";
type LibraryCharacter = { id: string; url: string; title: string };

const ASPECT_RATIO_LABELS: Record<VideoAspectRatio, string> = {
  "16:9": "16:9",
  "4:3": "4:3",
  "1:1": "1:1",
  "3:4": "3:4",
  "9:16": "9:16",
  "21:9": "21:9",
  "9:21": "9:21",
  adaptive: "Adaptive",
};

// Motion Control "Your character" — upload or pick any saved Photo Studio image.
function CharacterPicker({
  group,
  source,
  onSourceChange,
  selected,
  onSelect,
  disabled,
}: {
  group: RefGroupApi;
  source: CharacterSource;
  onSourceChange: (s: CharacterSource) => void;
  selected: LibraryCharacter | null;
  onSelect: (c: LibraryCharacter | null) => void;
  disabled?: boolean;
}) {
  return (
    <PhotoLibraryPicker
      label="Your character"
      icon={<UserRound className="h-3.5 w-3.5" />}
      accept={MC_IMAGE_ACCEPT}
      group={group}
      source={source}
      onSourceChange={onSourceChange}
      selected={selected}
      onSelect={onSelect}
      disabled={disabled}
      libraryKind="character"
      libraryEmptyLabel="No saved characters yet."
      hint="A clear image with a visible face and body. JPG/PNG."
    />
  );
}

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm";
const AUDIO_ACCEPT = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/webm";

function VideoOmniPage() {
  const searchParams = useSearchParams();

  // Deep-link support: the Photo → Storyboard "Create video" CTA navigates here
  // with ?type=storyboard&storyboardId=...; the dashboard reels links use
  // ?type=reels-creator. Any known subtool can be preselected via ?type=.
  const typeParam = searchParams.get("type");
  const initialType: VideoCreationType =
    typeParam === "storyboard"
      ? "storyboard"
      : typeParam === "motion_control"
        ? "motion_control"
        : typeParam === "image2video"
          ? "image2video"
          : typeParam === "reels-creator"
            ? "reels-creator"
            : "text2video";
  const initialStoryboardId = searchParams.get("storyboardId") || null;

  const [creationType, setCreationType] = useState<VideoCreationType>(initialType);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [mentionAssets, setMentionAssets] = useState<MentionAsset[]>([]);
  const [mentions, setMentions] = useState<MentionAsset[]>([]);
  const { balance, refetch: refetchCredits } = useCreditBalance();

  const [composerEnablement, setComposerEnablement] =
    useState<Record<VideoComposerKey, VideoComposerEnablement> | null>(null);

  useEffect(() => {
    let active = true;
    const loadEnablement = () => {
      fetch("/api/tools/video/features")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!active || !data?.composers) return;
          const raw = {} as Record<VideoComposerKey, { enabledTiers: string[]; defaultTier: string }>;
          for (const c of data.composers) {
            if (c.key) {
              raw[c.key as VideoComposerKey] = {
                enabledTiers: c.enabledModelIds ?? [],
                defaultTier: c.defaultModelId ?? "",
              };
            }
          }
          setComposerEnablement(mapVideoComposerEnablement(raw));
        })
        .catch(() => {});
    };

    loadEnablement();
    const onVisible = () => {
      if (document.visibilityState === "visible") loadEnablement();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const text2videoModels = filterEnabledCatalog(
    TEXT_TO_VIDEO_MODELS,
    "text2video",
    composerEnablement
  );
  const availableCreationTypes = CREATION_TYPES.filter((c) =>
    composerHasEnabledModels(c.id as VideoComposerKey, composerEnablement)
  );

  useEffect(() => {
    void loadMentionAssetsFromApi().then(setMentionAssets);
  }, [historyRefreshKey]);

  const handleCreationType = (id: string) => {
    if (
      id === "text2video" ||
      id === "image2video" ||
      id === "motion_control" ||
      id === "storyboard" ||
      id === "reels-creator"
    ) {
      setCreationType(id);
    }
  };

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

  useEffect(() => {
    if (availableCreationTypes.length === 0) return;
    if (availableCreationTypes.some((c) => c.id === creationType)) return;
    setCreationType(availableCreationTypes[0].id as VideoCreationType);
  }, [availableCreationTypes, creationType]);
  const supportsMentions =
    model.references.referenceImages > 0 || model.references.firstFrame;

  const [prompt, setPrompt] = useState("");
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

  const [loading, setLoading] = useState(false);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [resultSeed, setResultSeed] = useState<string | null>(null);
  const resultUrl = useSignedMediaUrl(resultPath, resultSeed);
  const [error, setError] = useState<string | null>(null);
  // Double-submit / double-charge guard (see lib/use-idempotent-submit.ts).
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling } = useIdempotentSubmit();

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
  const videoCost = videoCredits(pricingKey, duration);

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
    };

    // Stable key per attempt + synchronous in-flight lock: a double-click or a
    // retry after a network blip can't spawn a second provider run. The full
    // body is the signature, so any input change rotates the key.
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

      const data = await response.json();
      if (!response.ok) {
        // User-initiated cancellation: return to idle (credits were refunded),
        // not a red error. settle(false) keeps the key so a same-input retry
        // takes over the cancelled attempt server-side.
        if (data.code === "GENERATION_CANCELLED") {
          attempt.settle(false);
          setError(null);
          refetchCredits();
          return;
        }
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? videoCost}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Generation failed");
      }

      attempt.settle(true);
      setResultPath(pickGenerateStoragePath(data));
      setResultSeed(data.videoUrl ?? null);
      setHistoryRefreshKey((k) => k + 1);
      refetchCredits();

      // Clear the consumed references — their temp uploads were removed server-side.
      firstFrame.reset();
      lastFrame.reset();
      refImages.reset();
      refVideos.reset();
      refAudios.reset();
      setMentions([]);
    } catch (err: unknown) {
      attempt.settle(false);
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const selectedCreation = CREATION_TYPES.find((c) => c.id === "text2video");

  return (
    <div className="min-h-screen bg-[#030712] text-white selection:bg-purple-500/30">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-[10%] -top-[10%] h-[40%] w-[40%] rounded-full bg-purple-900/20 blur-[120px]" />
        <div className="absolute -right-[10%] top-[20%] h-[30%] w-[30%] rounded-full bg-indigo-900/20 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8">
          <h1 className="mb-3 bg-gradient-to-b from-white to-gray-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent">
            Video studio
          </h1>
        </div>

        {creationType === "text2video" && (
        <form onSubmit={handleGenerate} className="relative z-20 mt-0 py-[50px] lg:mt-10 lg:py-0">
          <style>{`
            @keyframes omniDotDrift { from { background-position: 0 0; } to { background-position: 48px 48px; } }
            @keyframes omniDotsPulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 0.6; } }
          `}</style>
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[180%] w-[135%] -translate-x-1/2 -translate-y-1/2"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(168,85,247,0.55) 1.2px, transparent 1.6px)",
              backgroundSize: "24px 24px",
              maskImage:
                "radial-gradient(ellipse 55% 55% at 50% 50%, #000 0%, rgba(0,0,0,0.35) 45%, transparent 72%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 55% 55% at 50% 50%, #000 0%, rgba(0,0,0,0.35) 45%, transparent 72%)",
              animation:
                "omniDotDrift 14s linear infinite, omniDotsPulse 5s ease-in-out infinite",
            }}
          />

          {/* Top-left chips: creation type + model */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ChipDropdown
              sheetTitle="Select creation type"
              icon={<Layers className="h-3.5 w-3.5" />}
              value={selectedCreation?.label ?? "Creation"}
              activeId="text2video"
                options={availableCreationTypes.map((c) => ({
                id: c.id,
                label: c.label,
                hint: c.available ? undefined : "Open",
              }))}
              onSelect={handleCreationType}
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
          </div>

          <div className="relative z-10 rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-colors focus-within:border-purple-400/40 sm:p-5">
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
                className="min-h-[64px] w-full resize-none bg-transparent text-base text-white placeholder:text-gray-500 focus:outline-none"
              />
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
                      className={`flex h-10 items-center gap-2 rounded-[4px] border px-3 text-sm font-semibold transition-colors disabled:opacity-40 ${
                        generateAudio
                          ? "border-purple-400/50 bg-purple-500/15 text-white"
                          : "border-white/10 bg-white/5 text-gray-300 hover:border-white/25"
                      }`}
                    >
                      {generateAudio ? (
                        <Volume2 className="h-3.5 w-3.5 text-purple-300" />
                      ) : (
                        <VolumeX className="h-3.5 w-3.5 text-gray-400" />
                      )}
                      Audio
                    </button>
                  </Tooltip>
                )}
              </div>

              <div className="hidden items-center gap-3 lg:flex">
                <CreditActionButton
                  balance={balance}
                  cost={videoCost}
                  ready={canGenerate}
                  loading={loading}
                  label="Generate"
                />
                {loading && (
                  <button
                    type="button"
                    onClick={() => cancelSubmit()}
                    disabled={cancelling}
                    className={CANCEL_BTN_CLASS}
                  >
                    {cancelling ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Cancelling</span>
                      </>
                    ) : (
                      <span>Cancel</span>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Model — attached under the form card on mobile only */}
          <StudioModelPanel>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-gray-500">Model</span>
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
          <div className="mt-3 flex items-center gap-3 lg:hidden">
            <CreditActionButton
              balance={balance}
              cost={videoCost}
              ready={canGenerate}
              loading={loading}
              label="Generate"
              className={`${GENERATE_BTN_CLASS} flex-1`}
            />
            {loading && (
              <button
                type="button"
                onClick={() => cancelSubmit()}
                disabled={cancelling}
                className={CANCEL_BTN_CLASS}
              >
                {cancelling ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Cancelling</span>
                  </>
                ) : (
                  <span>Cancel</span>
                )}
              </button>
            )}
          </div>

          {/* References */}
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 pl-1 text-xs font-semibold uppercase tracking-widest text-gray-500 sm:text-sm">
              <Sparkles className="h-3.5 w-3.5 text-purple-300" />
              References
              <span className="font-normal normal-case tracking-normal text-gray-600">(optional)</span>
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
                  hint="Image-to-video starting frame."
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
                  hint="End frame (needs a first frame)."
                />
              )}
              {model.references.referenceImages > 0 && (
                <RefGroup
                  icon={<ImageIcon className="h-3.5 w-3.5" />}
                  label="Reference images"
                  accept={IMAGE_ACCEPT}
                  multiple
                  group={refImages}
                  disabled={loading || (blocksFramesWithRefs && hasFrames) || refImagesBlocked1080p}
                  disabledReason={
                    blocksFramesWithRefs && hasFrames
                      ? "Remove first/last frame to use reference images."
                      : refImagesBlocked1080p
                        ? "Reference images are only supported at 480p or 720p."
                        : undefined
                  }
                  hint={
                    model.providerFamily === "kling3omni"
                      ? `Style/scene refs (up to ${refVideos.done.length > 0 ? 4 : 7}). Tag with @ or upload.`
                      : "Scene elements (up to 4). Tag with @ or upload."
                  }
                />
              )}
              {model.references.referenceVideos > 0 && (
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
                    model.providerFamily === "kling3omni"
                      ? "Motion/style reference (1 clip). Use [Video1] or upload."
                      : "Motion / style transfer. Use [Video1] or upload."
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
                  hint="Audio-driven / lip-sync. Use [Audio1]…"
                />
              )}
            </div>
          </div>

          {!refCheck.ok && (
            <p className="mt-2 pl-1 text-sm text-amber-300/80">{refCheck.error}</p>
          )}
        </form>
        )}

        {creationType === "text2video" && error && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {creationType === "text2video" && loading && (
          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
            <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
            Generating your video with {model.modelLabel} — this can take a couple of minutes. It will appear below when ready.
          </div>
        )}

        {creationType === "text2video" && resultUrl && !loading && (
          <div className="mt-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-4 sm:flex-row">
            <video
              src={resultUrl}
              controls
              playsInline
              className="w-full max-w-xs shrink-0 rounded-2xl border border-white/10 bg-black"
            />
            <div className="min-w-0">
              <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                <Check className="h-3 w-3" />
                Saved to your library
              </div>
              <p className="text-sm text-gray-300">
                {model.modelLabel} · {duration}s · {resolution} · {ASPECT_RATIO_LABELS[aspectRatio]}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Find it in your history below, or generate another.
              </p>
            </div>
          </div>
        )}

        {creationType === "image2video" && (
          <ImageToVideoComposer
            mentionAssets={mentionAssets}
            creationTypes={availableCreationTypes}
            composerEnablement={composerEnablement}
            onSelectCreation={handleCreationType}
            onGenerated={() => {
              setHistoryRefreshKey((k) => k + 1);
              refetchCredits();
            }}
          />
        )}

        {creationType === "motion_control" && (
          <MotionControlComposer
            creationTypes={availableCreationTypes}
            composerEnablement={composerEnablement}
            onSelectCreation={handleCreationType}
            onGenerated={() => {
              setHistoryRefreshKey((k) => k + 1);
              refetchCredits();
            }}
          />
        )}

        {creationType === "storyboard" && (
          <StoryboardToVideoComposer
            initialStoryboardId={initialStoryboardId}
            creationTypes={availableCreationTypes}
            composerEnablement={composerEnablement}
            onSelectCreation={handleCreationType}
            onGenerated={() => {
              setHistoryRefreshKey((k) => k + 1);
              refetchCredits();
            }}
          />
        )}

        {creationType === "reels-creator" && (
          <ReelsCreatorComposer
            creationTypes={availableCreationTypes}
            composerEnablement={composerEnablement}
            onSelectCreation={handleCreationType}
            onGenerated={() => {
              setHistoryRefreshKey((k) => k + 1);
              refetchCredits();
            }}
          />
        )}

        {/* Video generation history */}
        <div className="mt-0 lg:mt-[120px]">
          <CreationsHistory
            className="!mt-0"
            title="Generation history"
            description="Every video you create appears here. Click any clip to preview it."
            tools={[
              "video_text2video",
              "video_image2video",
              "video_motion_control",
              "storyboard_video",
              "reels_seedance",
              "reels_veo",
            ]}
            mediaType="video"
            refreshKey={historyRefreshKey}
            showActions
            showMeta={false}
            limit={20}
          />
        </div>
      </div>
    </div>
  );
}

// useSearchParams() requires a Suspense boundary in the App Router. Wrap the page
// so the storyboard deep-link (?type=storyboard&storyboardId=...) reads cleanly.
export default function VideoOmniPageWrapper() {
  return (
    <Suspense fallback={null}>
      <VideoOmniPage />
    </Suspense>
  );
}

const MC_IMAGE_ACCEPT = "image/jpeg,image/png";
const MC_VIDEO_ACCEPT = "video/mp4,video/quicktime";

// Image to Video — models that require a reference image (Kling v1.5 family).
function ImageToVideoComposer({
  mentionAssets,
  creationTypes,
  composerEnablement,
  onSelectCreation,
  onGenerated,
}: {
  mentionAssets: MentionAsset[];
  creationTypes: VideoCreationTypeOption[];
  composerEnablement: Record<VideoComposerKey, VideoComposerEnablement> | null;
  onSelectCreation: (id: string) => void;
  onGenerated: () => void;
}) {
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

  const [prompt, setPrompt] = useState("");
  const [mentions, setMentions] = useState<MentionAsset[]>([]);
  const [imageSource, setImageSource] = useState<PhotoLibrarySource>("upload");
  const [libraryImage, setLibraryImage] = useState<LibraryImage | null>(null);
  const [endImageSource, setEndImageSource] = useState<PhotoLibrarySource>("upload");
  const [endLibraryImage, setEndLibraryImage] = useState<LibraryImage | null>(null);
  const [duration, setDuration] = useState<number>(model.defaultDuration);
  const [resolution, setResolution] = useState(model.defaultResolution);
  const [aspectRatio, setAspectRatio] = useState(model.defaultAspectRatio);

  useEffect(() => {
    const m = getVideoModel(modelId);
    setResolution((r) => (m.resolutions.includes(r) ? r : m.defaultResolution));
    setAspectRatio((a) => (m.aspectRatios.includes(a) ? a : m.defaultAspectRatio));
    if (!m.references.lastFrame) setEndLibraryImage(null);
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

  const [loading, setLoading] = useState(false);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [resultSeed, setResultSeed] = useState<string | null>(null);
  const resultUrl = useSignedMediaUrl(resultPath, resultSeed);
  const [error, setError] = useState<string | null>(null);
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling } = useIdempotentSubmit();
  const { videoCredits } = usePricing();
  const { balance } = useCreditBalance();

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

  const pricingKey = model.pricingKey({ resolution });
  const cost = videoCredits(pricingKey, duration);

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

      const data = await response.json();
      if (!response.ok) {
        if (data.code === "GENERATION_CANCELLED") {
          attempt.settle(false);
          setError(null);
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
      setResultPath(pickGenerateStoragePath(data));
      setResultSeed(data.videoUrl ?? null);
      onGenerated();
      startImage.reset();
      endImage.reset();
      refImages.reset();
      setLibraryImage(null);
      setEndLibraryImage(null);
      setMentions([]);
    } catch (err: unknown) {
      attempt.settle(false);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <form onSubmit={handleGenerate} className="relative z-20 mt-0 py-[50px] lg:mt-10 lg:py-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ChipDropdown
            sheetTitle="Select creation type"
            icon={<Layers className="h-3.5 w-3.5" />}
            value="Image to video"
            activeId="image2video"
                options={creationTypes.map((c) => ({
              id: c.id,
              label: c.label,
              hint: c.available ? undefined : "Open",
            }))}
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
        </div>

        <div className="relative z-10 rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm sm:p-5">
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
              className={`flex min-h-[120px] flex-col rounded-2xl border border-dashed border-white/10 bg-black/20 p-3 ${
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
                hint={`Optional scene elements (up to ${model.references.referenceImages}). Tag with @ or upload.`}
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
                onSelect={(id) => setAspectRatio(id as typeof aspectRatio)}
                disabled={loading}
              />
              )}
            </div>

            <div className="hidden items-center gap-3 lg:flex">
              <CreditActionButton
                balance={balance}
                cost={cost}
                ready={canGenerate}
                loading={loading}
                label="Generate"
              />
              {loading && (
                <button
                  type="button"
                  onClick={() => cancelSubmit()}
                  disabled={cancelling}
                  className={CANCEL_BTN_CLASS}
                >
                  {cancelling ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Cancelling</span>
                    </>
                  ) : (
                    <span>Cancel</span>
                  )}
                </button>
              )}
            </div>
          </div>

          {!frameReady ? (
            <p className="mt-3 pl-1 text-sm text-amber-300/80">
              {model.requiresFirstFrame
                ? imageSource === "library"
                  ? "Pick a start image from your library."
                  : "Upload a start image to animate."
                : "Add a start image or end image (at least one)."}
            </p>
          ) : null}
        </div>

        {/* Model — attached under the form card on mobile only */}
        <StudioModelPanel>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-500">Model</span>
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
        <div className="mt-3 flex items-center gap-3 lg:hidden">
          <CreditActionButton
            balance={balance}
            cost={cost}
            ready={canGenerate}
            loading={loading}
            label="Generate"
            className={`${GENERATE_BTN_CLASS} flex-1`}
          />
          {loading && (
            <button
              type="button"
              onClick={() => cancelSubmit()}
              disabled={cancelling}
              className={CANCEL_BTN_CLASS}
            >
              {cancelling ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Cancelling</span>
                </>
              ) : (
                <span>Cancel</span>
              )}
            </button>
          )}
        </div>
      </form>

      {error && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
          <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
          Generating with {model.modelLabel} — this can take a couple of minutes.
        </div>
      )}

      {resultUrl && !loading && (
        <div className="mt-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-4 sm:flex-row">
          <video
            src={resultUrl}
            controls
            playsInline
            className="w-full max-w-xs shrink-0 rounded-2xl border border-white/10 bg-black"
          />
          <div className="min-w-0">
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
              <Check className="h-3 w-3" />
              Saved to your library
            </div>
            <p className="text-sm text-gray-300">
              {model.modelLabel} · {duration}s · {ASPECT_RATIO_LABELS[aspectRatio]}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

// Motion Control sub-tool. Mirrors the Higgsfield UX: upload your character image
// + the motion video to copy, optionally write a prompt, pick quality/orientation,
// and keep (or drop) the reference video's audio. The output clip length follows
// the reference video, so the cost is computed from its measured duration.
function MotionControlComposer({
  creationTypes,
  composerEnablement,
  onSelectCreation,
  onGenerated,
}: {
  creationTypes: VideoCreationTypeOption[];
  composerEnablement: Record<VideoComposerKey, VideoComposerEnablement> | null;
  onSelectCreation: (id: string) => void;
  onGenerated: () => void;
}) {
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
  const [orientation, setOrientation] = useState<CharacterOrientation>(model.defaultOrientation);
  const [keepOriginalSound, setKeepOriginalSound] = useState<boolean>(
    model.defaultKeepOriginalSound
  );
  const [videoDurationSec, setVideoDurationSec] = useState<number | null>(null);

  // Character source: upload your own, or pick one created in Photo → Character.
  const [charSource, setCharSource] = useState<CharacterSource>("upload");
  const [libraryChar, setLibraryChar] = useState<LibraryCharacter | null>(null);

  // The prompt is optional (Kling generates from just the image + motion video),
  // so it lives in a collapsed "Advanced" section to keep the form uncluttered.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [resultSeed, setResultSeed] = useState<string | null>(null);
  const resultUrl = useSignedMediaUrl(resultPath, resultSeed);
  const [error, setError] = useState<string | null>(null);
  // Double-submit / double-charge guard (see lib/use-idempotent-submit.ts).
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling } = useIdempotentSubmit();

  const { videoCredits } = usePricing();
  const { balance } = useCreditBalance();

  const charImage = useMediaRefs("image", 1);
  const motionVideo = useMediaRefs("video", 1);

  // Measure the reference video's duration so the cost label matches what the
  // server will bill (output length follows the reference video).
  const motionFile = motionVideo.items[0]?.file ?? null;
  useEffect(() => {
    if (!motionFile) {
      setVideoDurationSec(null);
      return;
    }
    const url = URL.createObjectURL(motionFile);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      setVideoDurationSec(Number.isFinite(el.duration) ? el.duration : null);
      URL.revokeObjectURL(url);
    };
    el.onerror = () => {
      setVideoDurationSec(null);
      URL.revokeObjectURL(url);
    };
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [motionFile]);

  const billedDuration = effectiveMotionControlDuration({
    model,
    refVideoDurationSec: videoDurationSec,
    orientation,
  });
  const pricingKey = model.pricingKey(mode);
  const cost = videoCredits(pricingKey, billedDuration);

  // Resolve the character image from whichever source is active. A library
  // character is a permanent creation (public URL), so it carries no temp path —
  // the server only sweeps temp upload paths, never library items.
  const resolvedCharacter: { url: string; path: string } | null =
    charSource === "library"
      ? libraryChar
        ? { url: libraryChar.url, path: "" }
        : null
      : charImage.done[0]
        ? { url: charImage.done[0].url, path: charImage.done[0].path }
        : null;

  const imageReady = resolvedCharacter !== null;
  const videoReady = motionVideo.done.length > 0;
  const anyUploading =
    motionVideo.uploading || (charSource === "upload" && charImage.uploading);
  const canGenerate = !loading && !anyUploading && imageReady && videoReady;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate) return;

    const body = {
      modelId,
      prompt: prompt.trim(),
      mode,
      characterOrientation: orientation,
      keepOriginalSound,
      refVideoDurationSec: videoDurationSec,
      image: resolvedCharacter,
      video: motionVideo.done[0]
        ? { url: motionVideo.done[0].url, path: motionVideo.done[0].path }
        : null,
    };

    // Stable key per attempt + synchronous in-flight lock (see hook docs).
    const attempt = beginSubmit(JSON.stringify(body));
    if (!attempt) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/generate-motion-control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok) {
        // User cancellation → back to idle (credits refunded), not a red error.
        if (data.code === "GENERATION_CANCELLED") {
          attempt.settle(false);
          setError(null);
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
      setResultPath(pickGenerateStoragePath(data));
      setResultSeed(data.videoUrl ?? null);
      onGenerated();
      charImage.reset();
      motionVideo.reset();
      setLibraryChar(null);
    } catch (err: unknown) {
      attempt.settle(false);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const orientationLabel =
    orientation === "video" ? "Facing: video (≤30s)" : "Facing: photo (≤10s)";

  return (
    <>
      <form onSubmit={handleGenerate} className="relative z-20 mt-0 py-[50px] lg:mt-10 lg:py-0">
        {/* Top-left chips: creation type + model */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ChipDropdown
            sheetTitle="Select creation type"
            icon={<Layers className="h-3.5 w-3.5" />}
            value="Motion control"
            activeId="motion_control"
                options={creationTypes.map((c) => ({
              id: c.id,
              label: c.label,
              hint: c.available ? undefined : "Open",
            }))}
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
                hint: formatMotionControlModelCreditHint(m, videoCredits),
              }))}
              onSelect={(id) => setModelId(id as MotionControlModelId)}
              disabled={loading}
            />
          </div>
        </div>

        <div className="relative z-10 rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm sm:p-5">
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
            <RefGroup
              icon={<Film className="h-3.5 w-3.5" />}
              label="Motion to copy"
              accept={MC_VIDEO_ACCEPT}
              multiple={false}
              group={motionVideo}
              disabled={loading}
              hint={
                videoDurationSec
                  ? `Reference video ~${Math.round(videoDurationSec)}s · billed ${billedDuration}s. MP4/MOV.`
                  : "Reference motion video, 3–30s. The character copies this motion. MP4/MOV."
              }
            />
          </div>

          {/* Advanced settings (collapsed by default). The prompt is optional —
              Kling generates from just the character image + motion video — so we
              tuck it away here. Motion still comes from the reference video; the
              prompt only adds background/scene details. */}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              aria-expanded={advancedOpen}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-400 transition-colors hover:text-gray-200"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-purple-300" />
              Advanced settings
              {!advancedOpen && prompt.trim() && (
                <span className="rounded-full bg-purple-500/20 px-1.5 py-0.5 text-xs font-medium text-purple-200">
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
                  <span className="text-sm font-semibold text-gray-200">Prompt</span>
                  <span className="text-sm font-medium text-gray-500">optional</span>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  maxLength={model.promptMaxChars}
                  placeholder={'Describe background and scene details \u2013 e.g., "A corgi runs in" or "Snowy park setting". Motion is controlled by your reference video.'}
                  rows={3}
                  className="min-h-[64px] w-full resize-none bg-transparent text-base text-white placeholder:text-gray-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Controls row */}
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className={STUDIO_CHIP_ROW_CLASS}>
              <ChipDropdown
                sheetTitle="Select quality"
                square
                showChevron={false}
                icon={<Maximize2 className="h-3.5 w-3.5" />}
                value={`${mode === "std" ? "Standard" : "Pro"} · ${motionControlResolutionLabel(mode)}`}
                activeId={mode}
                tooltip="Output quality. Standard renders at 720p; Pro is sharper 1080p but costs more credits."
                options={model.modes.map((m) => ({
                  id: m,
                  label: `${m === "std" ? "Standard" : "Pro"} · ${motionControlResolutionLabel(m)}`,
                  hint: `${videoCredits(model.pricingKey(m), billedDuration)}`,
                }))}
                onSelect={(id) => setMode(id as MotionControlMode)}
                disabled={loading}
              />
              <ChipDropdown
                sheetTitle="Select orientation"
                square
                showChevron={false}
                icon={<Repeat className="h-3.5 w-3.5" />}
                value={orientationLabel}
                activeId={orientation}
                tooltip="Which way your character faces in the result. “Photo” keeps the angle from your character image (clips up to 10s). “Video” makes the character follow the angles in your motion clip (clips up to 30s). This does not change the background."
                options={[
                  { id: "image", label: "Facing: photo (≤10s)" },
                  { id: "video", label: "Facing: video (≤30s)" },
                ]}
                onSelect={(id) => setOrientation(id as CharacterOrientation)}
                disabled={loading}
              />
              <Tooltip
                className="flex-1 lg:flex-none"
                label={
                  keepOriginalSound
                    ? "On — your result keeps the reference video's original audio. Click to mute it."
                    : "Off — the reference video's audio is removed. Click to keep it."
                }
              >
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setKeepOriginalSound((v) => !v)}
                  className={`flex h-10 w-full items-center justify-center gap-2 rounded-[4px] px-3 text-sm font-semibold transition-colors disabled:opacity-40 lg:w-auto lg:justify-start ${
                    keepOriginalSound
                      ? "bg-purple-500/15 text-white"
                      : "bg-white/5 text-gray-200 hover:bg-white/10"
                  }`}
                >
                  {keepOriginalSound ? (
                    <Volume2 className="h-3.5 w-3.5 text-purple-300" />
                  ) : (
                    <VolumeX className="h-3.5 w-3.5 text-gray-400" />
                  )}
                  Original sound
                </button>
              </Tooltip>
            </div>

            <div className="hidden items-center gap-3 lg:flex">
              <CreditActionButton
                balance={balance}
                cost={cost}
                ready={canGenerate}
                loading={loading}
                label="Generate"
              />
              {loading && (
                <button
                  type="button"
                  onClick={() => cancelSubmit()}
                  disabled={cancelling}
                  className={CANCEL_BTN_CLASS}
                >
                  {cancelling ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Cancelling</span>
                    </>
                  ) : (
                    <span>Cancel</span>
                  )}
                </button>
              )}
            </div>
          </div>

          {!imageReady || !videoReady ? (
            <p className="mt-3 pl-1 text-sm text-amber-300/80">
              Add both your character image and a motion video to generate.
            </p>
          ) : null}
        </div>

        {/* Model — attached under the form card on mobile only */}
        <StudioModelPanel>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-500">Model</span>
            <ChipDropdown
              sheetTitle="Select model"
              bare
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={model.modelLabel}
              activeId={modelId}
              options={motionControlModels.map((m) => ({
                id: m.id,
                label: m.modelLabel,
                hint: formatMotionControlModelCreditHint(m, videoCredits),
              }))}
              onSelect={(id) => setModelId(id as MotionControlModelId)}
              disabled={loading}
            />
          </div>
        </StudioModelPanel>

        {/* Generate (mobile — below the form card) */}
        <div className="mt-3 flex items-center gap-3 lg:hidden">
          <CreditActionButton
            balance={balance}
            cost={cost}
            ready={canGenerate}
            loading={loading}
            label="Generate"
            className={`${GENERATE_BTN_CLASS} flex-1`}
          />
          {loading && (
            <button
              type="button"
              onClick={() => cancelSubmit()}
              disabled={cancelling}
              className={CANCEL_BTN_CLASS}
            >
              {cancelling ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Cancelling</span>
                </>
              ) : (
                <span>Cancel</span>
              )}
            </button>
          )}
        </div>
      </form>

      {error && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
          <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
          Generating with {model.modelLabel} — this can take a couple of minutes. It will appear below when ready.
        </div>
      )}

      {resultUrl && !loading && (
        <div className="mt-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-4 sm:flex-row">
          <video
            src={resultUrl}
            controls
            playsInline
            className="w-full max-w-xs shrink-0 rounded-2xl border border-white/10 bg-black"
          />
          <div className="min-w-0">
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
              <Check className="h-3 w-3" />
              Saved to your library
            </div>
            <p className="text-sm text-gray-300">
              {model.modelLabel} · {mode === "std" ? "Standard" : "Pro"} · {motionControlResolutionLabel(mode)}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Find it in your history below, or generate another.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

type StoryboardListItem = {
  id: string;
  storyboardUrl: string;
  theme: string;
  hasVideo: boolean;
  // The orientation the storyboard was created in. null only for legacy rows
  // saved before the aspect_ratio column existed (then the user may pick it).
  aspectRatio: StoryboardAspectRatio | null;
  // Spoken language the storyboard was written in. null for legacy rows; used as
  // the default here but the user may still change it (soft, re-instructable).
  language: StoryboardLanguageId | null;
  // The stored Seedance prompt — surfaced in the Advanced "edit prompt" panel so
  // the user can review/tweak it before rendering.
  seedancePrompt: string;
  // 'uploaded' for storyboards the user imported, 'generated' otherwise.
  source: string | null;
};

function storyboardVideoPricingKey(
  modelId: StoryboardVideoModelId,
  resolution: "480p" | "720p"
): string {
  return getVideoModel(modelId).pricingKey({ resolution, hasReferenceVideo: false });
}

// Storyboard to Video sub-tool. The storyboard itself is created in Photo →
// Storyboard; here the user picks one of their saved storyboards, a resolution,
// and a Seedance model (Mini default; Fast or full Seedance 2 optional), then renders the 15s clip.
const STORYBOARD_VIDEO_DURATION_SEC = 15;

// Modal for importing a user's OWN storyboard image (not generated in Kelolako).
// Uploads the file to the transient refs path, then asks /api/storyboards/import
// to run a GPT-5 vision pass (charged) that synthesizes the seedance_prompt and
// registers a storyboards row. On success the new board is handed back to the
// composer, which selects it.
function ImportStoryboardModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (item: StoryboardListItem) => void;
}) {
  const { imageCredits } = usePricing();
  const { balance } = useCreditBalance();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [aspect, setAspect] = useState<StoryboardAspectRatio>(DEFAULT_STORYBOARD_ASPECT_RATIO);
  const [language, setLanguage] = useState<StoryboardLanguageId>(DEFAULT_STORYBOARD_LANGUAGE);
  const [style, setStyle] = useState<StoryboardStyleKey>(DEFAULT_STORYBOARD_STYLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Double-submit / double-charge guard (see lib/use-idempotent-submit.ts).
  const { begin: beginSubmit } = useIdempotentSubmit();

  const cost = imageCredits("storyboard_import_vision_per_image", 1);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      setError("Please choose a JPG, PNG, or WebP image.");
      return;
    }
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const analyze = async () => {
    if (!file || busy) return;
    // Acquire the synchronous in-flight lock BEFORE the upload so a double-click
    // can't upload the sheet and charge the vision pass twice. Each attempt
    // re-uploads to a fresh temp path (which the server folds into its request
    // hash), so the key is unique per attempt — here the lock, not key reuse, is
    // what prevents the duplicate.
    const attempt = beginSubmit(`storyboard-import:${Date.now()}:${Math.random()}`);
    if (!attempt) return;
    setBusy(true);
    setError(null);
    try {
      const { path } = await uploadRefFile(file);
      const response = await fetch("/api/storyboards/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: JSON.stringify({
          imagePath: path,
          description: description.trim(),
          aspectRatio: aspect,
          language,
          storyboardStyle: style,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? cost}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Couldn't import the storyboard.");
      }
      attempt.settle(true);
      onImported({
        id: String(data.storyboardId),
        storyboardUrl: String(data.storyboardUrl),
        theme: description.trim() || "Imported storyboard",
        hasVideo: false,
        aspectRatio: resolveStoryboardAspectRatio(data.aspectRatio),
        language: resolveStoryboardLanguage(data.language),
        seedancePrompt: typeof data.seedancePrompt === "string" ? data.seedancePrompt : "",
        source: "uploaded",
      });
    } catch (err: unknown) {
      attempt.settle(false);
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
      />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#0e0e12] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-purple-300" />
            <h3 className="text-sm font-bold text-white">Upload your own storyboard</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
          {/* File picker / preview */}
          <label
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-6 text-center transition-colors ${
              previewUrl ? "border-white/15 bg-black/30" : "border-white/20 hover:border-purple-400/50"
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
                <Upload className="h-6 w-6 text-gray-400" />
                <span className="text-sm text-gray-300">Click to choose an image</span>
                <span className="text-sm text-gray-500">JPG / PNG / WebP · up to 100 MB</span>
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
              <span className="text-sm font-semibold text-purple-300">Change image</span>
            )}
          </label>

          {/* Optional description */}
          <div>
            <label className="mb-1 block text-xs sm:text-sm font-semibold uppercase tracking-wider text-gray-400">
              Description <span className="text-gray-600">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              disabled={busy}
              placeholder="What should happen in the video? Helps steer the analysis."
              className="w-full resize-none rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white placeholder:text-gray-600 focus:border-purple-400/40 focus:outline-none"
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
              value={STORYBOARD_STYLE_LABELS[style]}
              activeId={style}
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
            <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
          <p className="text-sm text-gray-500">
            We analyze the image to write the video prompt — you can edit it before rendering.
          </p>
          <CreditActionButton
            type="button"
            onClick={analyze}
            balance={balance}
            cost={cost}
            ready={!!file}
            loading={busy}
            label="Analyze"
            className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-[4px] bg-gradient-to-r from-fuchsia-500 to-pink-500 px-5 text-sm font-bold uppercase tracking-wide text-white shadow-lg shadow-pink-500/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>
      </div>
    </div>
  );
}

function StoryboardToVideoComposer({
  initialStoryboardId,
  creationTypes,
  composerEnablement,
  onSelectCreation,
  onGenerated,
}: {
  initialStoryboardId: string | null;
  creationTypes: VideoCreationTypeOption[];
  composerEnablement: Record<VideoComposerKey, VideoComposerEnablement> | null;
  onSelectCreation: (id: string) => void;
  onGenerated: () => void;
}) {
  const storyboardModels = filterEnabledCatalog(
    STORYBOARD_VIDEO_MODEL_IDS.map((id) => getVideoModel(id)),
    "storyboard",
    composerEnablement
  );
  const { videoCredits } = usePricing();
  const { balance } = useCreditBalance();

  const [items, setItems] = useState<StoryboardListItem[]>([]);
  const [listState, setListState] = useState<"loading" | "loaded" | "error">("loading");
  const [selectedId, setSelectedId] = useState<string | null>(initialStoryboardId);
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

  const [loading, setLoading] = useState(false);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [resultSeed, setResultSeed] = useState<string | null>(null);
  const resultUrl = useSignedMediaUrl(resultPath, resultSeed);
  const [error, setError] = useState<string | null>(null);
  // Double-submit / double-charge guard: stable Idempotency-Key per attempt +
  // synchronous in-flight lock, so a double-click or a retry after a network
  // blip can never spawn a second Replicate run for the same storyboard.
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling } = useIdempotentSubmit();
  // "Upload your own storyboard" modal.
  const [showUpload, setShowUpload] = useState(false);
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
        setSelectedId((cur) => {
          if (cur && list.some((s) => s.id === cur)) return cur;
          return list[0]?.id ?? null;
        });
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
  const cost = videoCredits(pricingKey, STORYBOARD_VIDEO_DURATION_SEC);
  const selected = items.find((s) => s.id === selectedId) ?? null;
  const canGenerate = !loading && !!selectedId;
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
    setLanguage(selected?.language ?? DEFAULT_STORYBOARD_LANGUAGE);
  }, [selectedId, selected?.language]);

  // Reset the editable prompt draft to the selected storyboard's stored prompt
  // when the selection changes (keyed on id so a user edit isn't clobbered).
  useEffect(() => {
    setPromptDraft(selected?.seedancePrompt ?? "");
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const storedPrompt = selected?.seedancePrompt ?? "";
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

    const editedPrompt = promptDirty ? promptDraft.trim() : undefined;
    // Signature mirrors the fields the server hashes for idempotency (durationSec
    // is fixed server-side) so the key is reused only while the request is
    // unchanged. begin() returns null when a submit is already in flight — that
    // drops a same-tick double-click before it can fire a second request.
    const signature = JSON.stringify({
      storyboardId: selectedId,
      videoModelId,
      resolution,
      aspectRatio: aspect,
      language,
      promptOverride: editedPrompt ?? null,
    });
    const attempt = beginSubmit(signature);
    if (!attempt) return;

    setLoading(true);
    setError(null);
    setResultPath(null);
    setResultSeed(null);
    try {
      const response = await fetch("/api/generate-storyboard-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: JSON.stringify({
          storyboardId: selectedId,
          videoModelId,
          resolution,
          aspectRatio: aspect,
          language,
          ...(editedPrompt ? { seedancePrompt: editedPrompt } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        // User cancellation → back to idle (credits refunded), not a red error.
        if (data.code === "GENERATION_CANCELLED") {
          attempt.settle(false);
          setError(null);
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
      // Confirmed success (or a server-side replay of the same key): retire the
      // key so the next click starts a fresh generation.
      attempt.settle(true);
      // If the prompt was edited it is now the stored prompt — reflect that in
      // local state so re-selecting the board shows the saved edit.
      if (editedPrompt) {
        setItems((cur) =>
          cur.map((s) => (s.id === selectedId ? { ...s, seedancePrompt: editedPrompt } : s))
        );
      }
      setResultPath(pickGenerateStoragePath(data));
      setResultSeed(data.videoUrl ?? null);
      onGenerated();
    } catch (err: unknown) {
      // Keep the key so an immediate identical retry dedupes server-side
      // (replay / in-progress / takeover) rather than launching a second run.
      attempt.settle(false);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <form onSubmit={handleGenerate} className="relative z-20 mt-0 py-[50px] lg:mt-10 lg:py-0">
        {/* Top-left chips: creation type + model */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ChipDropdown
            sheetTitle="Select creation type"
            icon={<Layers className="h-3.5 w-3.5" />}
            value="Storyboard to video"
            activeId="storyboard"
                options={creationTypes.map((c) => ({
              id: c.id,
              label: c.label,
              hint: c.available ? undefined : "Open",
            }))}
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
        </div>

        <div className="relative z-10 rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm sm:p-5">
          {/* Storyboard picker */}
          <div className="mb-1 flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold uppercase tracking-wider text-gray-400">
              <span className="text-purple-300">
                <ImageIcon className="h-3.5 w-3.5" />
              </span>
              Choose a storyboard
            </span>
          </div>

          {listState === "loading" ? (
            <div className="flex h-24 items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin text-purple-300" />
              Loading your storyboards…
            </div>
          ) : listState === "error" ? (
            <div className="flex h-24 items-center gap-2 text-sm text-red-300">
              <AlertCircle className="h-4 w-4" /> Couldn&apos;t load your storyboards.
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1 text-sm text-gray-500">
                <span>You don&apos;t have any storyboards yet.</span>
                <a
                  href="/tools/photo-v2?type=storyboard"
                  className="font-semibold text-purple-300 hover:text-purple-200"
                >
                  Create one in Photo → Storyboard →
                </a>
              </div>
              <button
                type="button"
                disabled={loading}
                onClick={() => setShowUpload(true)}
                className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-4 py-3 text-sm font-semibold text-gray-300 transition-colors hover:border-purple-400/50 hover:text-white disabled:opacity-40"
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
                className="flex h-full min-h-[108px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/20 bg-white/[0.02] text-gray-400 transition-colors hover:border-purple-400/50 hover:text-white disabled:opacity-40"
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
                        ? "border-purple-400 ring-2 ring-purple-400/40"
                        : "border-white/10 hover:border-white/30"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.storyboardUrl}
                      alt={s.theme}
                      className="aspect-[3/2] w-full object-cover"
                    />
                    <span className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-gray-300">
                      {s.aspectRatio && (
                        <span className="shrink-0 rounded bg-white/10 px-1 py-0.5 text-xs font-semibold text-gray-200">
                          {s.aspectRatio}
                        </span>
                      )}
                      <span className="truncate">{s.theme}</span>
                    </span>
                    {s.hasVideo && (
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-300">
                        Has video
                      </span>
                    )}
                    {s.source === "uploaded" && (
                      <span className="absolute left-1.5 bottom-9 rounded-full bg-black/70 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-sky-300">
                        Uploaded
                      </span>
                    )}
                    {active && (
                      <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-purple-500 text-white">
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
              <CreditActionButton
                balance={balance}
                cost={cost}
                ready={canGenerate}
                loading={loading}
                label="Create video"
              />
              {loading && (
                <button
                  type="button"
                  onClick={() => cancelSubmit()}
                  disabled={cancelling}
                  className={CANCEL_BTN_CLASS}
                >
                  {cancelling ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Cancelling</span>
                    </>
                  ) : (
                    <span>Cancel</span>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Advanced: review / edit the Seedance prompt before rendering. */}
          {selectedId ? (
            <div className="mt-4 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                className="flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 transition-colors hover:text-gray-200 sm:text-sm"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                />
                <Pencil className="h-3.5 w-3.5 text-purple-300" />
                Advanced — edit prompt
                {promptDirty && (
                  <span className="rounded-full bg-purple-500/20 px-1.5 py-0.5 text-xs font-bold text-purple-200">
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
                    className="w-full resize-y rounded-xl border border-white/10 bg-black/30 p-3 text-sm leading-relaxed text-gray-200 placeholder:text-gray-600 focus:border-purple-400/40 focus:outline-none"
                  />
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-sm text-gray-500">
                    <span>
                      Style, orientation &amp; language are re-applied automatically on render.
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={
                          promptDraft.length > SEEDANCE_PROMPT_BODY_BUDGET_CHARS
                            ? "font-semibold text-amber-300"
                            : "text-gray-500"
                        }
                        title={`Keep the prompt under ~${SEEDANCE_PROMPT_BODY_BUDGET_CHARS} characters so style, orientation & language can be added without the video model truncating it.`}
                      >
                        {promptDraft.length}/{SEEDANCE_PROMPT_BODY_BUDGET_CHARS}
                      </span>
                      {promptDirty && (
                        <button
                          type="button"
                          onClick={() => setPromptDraft(storedPrompt)}
                          className="font-semibold text-gray-400 hover:text-gray-200"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                  {promptDraft.length > SEEDANCE_PROMPT_BODY_BUDGET_CHARS && (
                    <p className="mt-1 text-sm text-amber-300/80">
                      This prompt is long — it may be trimmed at a sentence boundary on render so the style, orientation &amp; language directives still fit. Shorten it for full fidelity.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {!selectedId && listState === "loaded" && items.length > 0 ? (
            <p className="mt-3 pl-1 text-sm text-amber-300/80">
              Pick a storyboard to turn into a video.
            </p>
          ) : null}
        </div>

        {/* Model — attached under the form card on mobile only */}
        <StudioModelPanel>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-500">Model</span>
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
        <div className="mt-3 flex items-center gap-3 lg:hidden">
          <CreditActionButton
            balance={balance}
            cost={cost}
            ready={canGenerate}
            loading={loading}
            label="Create video"
            className={`${GENERATE_BTN_CLASS} flex-1`}
          />
          {loading && (
            <button
              type="button"
              onClick={() => cancelSubmit()}
              disabled={cancelling}
              className={CANCEL_BTN_CLASS}
            >
              {cancelling ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Cancelling</span>
                </>
              ) : (
                <span>Cancel</span>
              )}
            </button>
          )}
        </div>
      </form>

      {showUpload && (
        <ImportStoryboardModal
          onClose={() => setShowUpload(false)}
          onImported={handleImported}
        />
      )}

      {error && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
          <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
          Rendering your storyboard into a 15s clip — it will appear below when ready.
        </div>
      )}

      {resultUrl && !loading && (
        <div className="mt-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-4 sm:flex-row">
          <video
            src={resultUrl}
            controls
            playsInline
            className={`shrink-0 rounded-2xl border border-white/10 bg-black ${
              aspect === "9:16" ? "w-full max-w-[260px]" : "w-full max-w-md"
            }`}
          />
          <div className="min-w-0">
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
              <Check className="h-3 w-3" />
              Saved to your library
            </div>
            <p className="text-sm text-gray-300">
              {storyboardVideoModel.modelLabel} · 15s · {resolution} · {aspect} {storyboardOrientationLabel(aspect)} · {storyboardLanguageLabel(language)}
              {selected ? ` · ${selected.theme}` : ""}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Find it in your history below, or render another resolution.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reels Creator sub-tool. Consolidates the legacy ReelsGen Veo + Seedance page
// into one composer that POSTs to the unified /api/generate-reels route. Engine
// (Seedance 2 Fast | Veo 3.1 Lite) is the "model" chip; Veo adds a Mode chip (Single | Per
// scene). Adaptive controls + narrator + caption styler + a live caption preview
// whose 480x854 math mirrors the ASS MarginV math on the server.
// ---------------------------------------------------------------------------

// MiniMax speech-02-turbo English voice catalogue (storytelling voices first).
const REELS_ENGLISH_VOICES = [
  "English_CaptivatingStoryteller",
  "English_WiseScholar",
  "English_Wiselady",
  "English_Steadymentor",
  "English_MaturePartner",
  "English_Trustworth_Man",
  "English_Deep-VoicedGentleman",
  "English_ManWithDeepVoice",
  "English_Gentle-voiced_man",
  "English_Diligent_Man",
  "English_PatientMan",
  "English_DecentYoungMan",
  "English_ReservedYoungMan",
  "English_FriendlyPerson",
  "English_MatureBoss",
  "English_BossyLeader",
  "English_Debator",
  "English_ImposingManner",
  "English_PassionateWarrior",
  "English_Comedian",
  "English_Jovialman",
  "English_Aussie_Bloke",
  "English_ConfidentWoman",
  "English_AssertiveQueen",
  "English_Graceful_Lady",
  "English_CalmWoman",
  "English_SereneWoman",
  "English_SentimentalLady",
  "English_StressedLady",
  "English_LovelyGirl",
  "English_Kind-heartedGirl",
  "English_Soft-spokenGirl",
  "English_PlayfulGirl",
  "English_WhimsicalGirl",
  "English_Whispering_girl",
  "English_UpsetGirl",
  "English_SadTeen",
  "English_Strong-WilledBoy",
  "English_AnimeCharacter",
];

const REELS_EMOTIONS = [
  "auto",
  "happy",
  "sad",
  "angry",
  "fearful",
  "disgusted",
  "surprised",
  "calm",
  "fluent",
  "neutral",
];

const REELS_CAPTION_FONTS = ["Arial", "Poppins", "Montserrat", "Bangers"];

const humanizeReelsVoice = (id: string) =>
  id
    .replace(/^English_/, "")
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const humanizeReelsEmotion = (e: string) =>
  e === "auto" ? "Auto (let AI decide)" : e.charAt(0).toUpperCase() + e.slice(1);

type ReelsCaptionStyle = {
  fontname: string;
  fontsize: number;
  primaryColor: string;
  highlightColor: string;
  outlineColor: string;
  outlineThickness: number;
  marginV: number;
  highlightOnly: boolean;
};

// Themed dropdown replacing the native <select> in the caption styler. Matches
// the studio's dark/glass aesthetic and previews each font in its own typeface.
function ThemedSelect({
  value,
  options,
  onChange,
  disabled,
  previewFont = false,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  previewFont?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-black/30 p-2.5 text-left text-sm text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          open ? "border-purple-400/50 bg-purple-500/10" : "border-white/10 hover:border-white/25"
        }`}
      >
        <span style={previewFont ? { fontFamily: `"${value}", sans-serif` } : undefined}>
          {value}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#0b1020] p-1.5 shadow-2xl shadow-black/50">
          {options.map((opt) => {
            const active = opt === value;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  active ? "bg-purple-500/20 text-white" : "text-gray-300 hover:bg-white/5"
                }`}
                style={previewFont ? { fontFamily: `"${opt}", sans-serif` } : undefined}
              >
                {opt}
                {active && <Check className="h-4 w-4 shrink-0 text-purple-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Themed numeric stepper replacing the native number input (whose spin buttons
// don't respect the app theme). Keeps the field typeable; −/+ clamp to min/max.
function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const set = (n: number) => {
    if (!Number.isNaN(n)) onChange(clamp(n));
  };
  return (
    <div className="flex items-stretch overflow-hidden rounded-xl border border-white/10 bg-black/30 transition-colors focus-within:border-purple-400/40">
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => set(value - step)}
        aria-label="Decrease"
        className="flex w-10 shrink-0 items-center justify-center text-gray-300 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Minus className="h-4 w-4" />
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value))}
        className="w-full min-w-0 border-x border-white/10 bg-transparent p-2.5 text-center text-sm font-semibold text-white focus:outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => set(value + step)}
        aria-label="Increase"
        className="flex w-10 shrink-0 items-center justify-center text-gray-300 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function ReelsCreatorComposer({
  creationTypes,
  composerEnablement,
  onSelectCreation,
  onGenerated,
}: {
  creationTypes: VideoCreationTypeOption[];
  composerEnablement: Record<VideoComposerKey, VideoComposerEnablement> | null;
  onSelectCreation: (id: string) => void;
  onGenerated: () => void;
}) {
  const reelsEngines = filterReelsEngines(REELS_ENGINES, composerEnablement);
  const { videoCredits } = usePricing();
  const { balance } = useCreditBalance();
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling } = useIdempotentSubmit();

  // Engine + (Veo-only) mode.
  const [engine, setEngine] = useState<ReelsEngine>("seedance");

  useEffect(() => {
    if (reelsEngines.length === 0) return;
    if (reelsEngines.some((e) => e.id === engine)) return;
    setEngine(reelsEngines[0].id);
  }, [reelsEngines, engine]);
  const [veoMode, setVeoMode] = useState<ReelsVeoMode>("single");

  // Shared.
  const [theme, setTheme] = useState("");
  const [voiceId, setVoiceId] = useState<string>(DEFAULT_VOICE_ID);
  const [emotion, setEmotion] = useState("auto");

  // Seedance controls.
  const [numScenes, setNumScenes] = useState(1);
  const [durationPerScene, setDurationPerScene] = useState(5);
  const [resolution, setResolution] = useState<SeedanceResolution>("480p");

  // Veo controls.
  const [veoDuration, setVeoDuration] = useState<4 | 6 | 8>(6);
  const [veoResolution, setVeoResolution] = useState<VeoResolution>("720p");
  const [singlePromptScenes, setSinglePromptScenes] = useState<1 | 2>(1);
  const [veoNumScenes, setVeoNumScenes] = useState(1);

  const [captionStyle, setCaptionStyle] = useState<ReelsCaptionStyle>({
    fontname: "Poppins",
    fontsize: 60,
    primaryColor: "#FFFFFF",
    highlightColor: "#FFFF00",
    outlineColor: "#000000",
    outlineThickness: 4,
    marginV: 15,
    highlightOnly: true,
  });

  const [loading, setLoading] = useState(false);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [resultSeed, setResultSeed] = useState<string | null>(null);
  const resultUrl = useSignedMediaUrl(resultPath, resultSeed);
  const [error, setError] = useState<string | null>(null);

  // 1080p forces an 8s clip (Veo 3.1 Lite constraint) — keep state valid.
  const onVeoResolution = (r: VeoResolution) => {
    setVeoResolution(r);
    if (r === "1080p") setVeoDuration(8);
  };

  const totalDuration = reelsTotalDurationSec({
    engine,
    mode: veoMode,
    durationPerScene,
    numScenes: engine === "seedance" ? numScenes : veoNumScenes,
    veoDuration,
  });
  const pricingKey = reelsPricingKey(
    engine,
    engine === "seedance" ? resolution : veoResolution
  );
  const cost = videoCredits(pricingKey, totalDuration);

  const canGenerate = !loading && theme.trim().length > 0;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate) return;

    const body: Record<string, unknown> =
      engine === "seedance"
        ? {
            engine: "seedance",
            theme: theme.trim(),
            numScenes: Number(numScenes),
            durationPerScene: Number(durationPerScene),
            resolution,
            voiceId,
            emotion,
            captionStyle,
          }
        : {
            engine: "veo",
            mode: veoMode,
            theme: theme.trim(),
            duration: veoDuration,
            resolution: veoResolution,
            voiceId,
            emotion,
            captionStyle,
            ...(veoMode === "single"
              ? { singlePromptScenes }
              : { numScenes: Number(veoNumScenes) }),
          };

    // Stable key per attempt + synchronous in-flight lock (see hook docs).
    const attempt = beginSubmit(`reels-${engine}:${JSON.stringify(body)}`);
    if (!attempt) return;

    setLoading(true);
    setError(null);
    setResultPath(null);
    setResultSeed(null);

    try {
      const response = await fetch("/api/generate-reels", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok) {
        // User cancellation → back to idle (credits refunded), not a red error.
        if (data.code === "GENERATION_CANCELLED") {
          attempt.settle(false);
          setError(null);
          onGenerated();
          return;
        }
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? cost}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Failed to generate video");
      }

      attempt.settle(true);
      setResultPath(pickGenerateStoragePath(data));
      setResultSeed(data.videoUrl ?? null);
      onGenerated();
    } catch (err: unknown) {
      attempt.settle(false);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Adaptive control chips per engine/mode.
  const veoDurations = veoResolution === "1080p" ? [8] : [4, 6, 8];

  return (
    <>
      <form onSubmit={handleGenerate} className="relative z-20 mt-0 py-[50px] lg:mt-10 lg:py-0">
        {/* Top-left chips: creation type + engine (+ Veo mode) */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ChipDropdown
            sheetTitle="Select creation type"
            icon={<Layers className="h-3.5 w-3.5" />}
            value="Reels Creator"
            activeId="reels-creator"
                options={creationTypes.map((c) => ({ id: c.id, label: c.label }))}
            onSelect={onSelectCreation}
            disabled={loading}
          />
          {/* Engine chip stays inline in the top row on desktop only */}
          <div className="hidden lg:block">
            <ChipDropdown
              sheetTitle="Select engine"
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={reelsEngineLabel(engine)}
              activeId={engine}
              options={reelsEngines.map((e) => ({ id: e.id, label: e.label }))}
              onSelect={(id) => setEngine(id as ReelsEngine)}
              disabled={loading}
            />
          </div>
          {engine === "veo" && (
            <ChipDropdown
              sheetTitle="Select mode"
              icon={<Film className="h-3.5 w-3.5" />}
              value={veoMode === "single" ? "Single video" : "Per scene"}
              activeId={veoMode}
              options={[
                { id: "single", label: "Single video" },
                { id: "perScene", label: "Per scene" },
              ]}
              onSelect={(id) => setVeoMode(id as ReelsVeoMode)}
              disabled={loading}
            />
          )}
        </div>

        <div className="relative z-10 rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-colors focus-within:border-purple-400/40 sm:p-5">
          {/* Theme */}
          <textarea
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="Describe your reel — e.g., The history of space exploration in 60 seconds. Our AI writes the script, scenes, narration, and captions."
            rows={3}
            disabled={loading}
            className="min-h-[64px] w-full resize-none bg-transparent text-base text-white placeholder:text-gray-500 focus:outline-none"
          />

          {/* Controls row */}
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className={STUDIO_CHIP_ROW_CLASS}>
              {engine === "seedance" ? (
                <>
                  <ChipDropdown
                    sheetTitle="Select scene count"
                    square
                    showChevron={false}
                    icon={<Layers className="h-3.5 w-3.5" />}
                    value={`${numScenes} scene${numScenes > 1 ? "s" : ""}`}
                    activeId={String(numScenes)}
                    tooltip="How many scenes to break the story into. More scenes = a longer reel."
                    options={[1, 2, 3].map((n) => ({
                      id: String(n),
                      label: `${n} scene${n > 1 ? "s" : ""}`,
                      hint: `${videoCredits(reelsPricingKey("seedance", resolution), n * durationPerScene)}`,
                    }))}
                    onSelect={(id) => setNumScenes(Number(id))}
                    disabled={loading}
                  />
                  <ChipDropdown
                    sheetTitle="Select scene length"
                    square
                    showChevron={false}
                    icon={<Clock className="h-3.5 w-3.5" />}
                    value={`${durationPerScene}s / scene`}
                    activeId={String(durationPerScene)}
                    tooltip="Seconds per scene. Total reel length = scenes × this."
                    options={[5, 10].map((d) => ({
                      id: String(d),
                      label: `${d} seconds / scene`,
                      hint: `${videoCredits(reelsPricingKey("seedance", resolution), numScenes * d)}`,
                    }))}
                    onSelect={(id) => setDurationPerScene(Number(id))}
                    disabled={loading}
                  />
                  <ChipDropdown
                    sheetTitle="Select resolution"
                    square
                    showChevron={false}
                    icon={<Maximize2 className="h-3.5 w-3.5" />}
                    value={resolution}
                    activeId={resolution}
                    tooltip="Video resolution. 720p is crisper but costs more credits."
                    options={(["480p", "720p"] as const).map((r) => ({
                      id: r,
                      label: r === "480p" ? "480p (Fast)" : "720p (HD)",
                      hint: `${videoCredits(reelsPricingKey("seedance", r), totalDuration)}`,
                    }))}
                    onSelect={(id) => setResolution(id as SeedanceResolution)}
                    disabled={loading}
                  />
                </>
              ) : (
                <>
                  <ChipDropdown
                    sheetTitle="Select clip length"
                    square
                    showChevron={false}
                    icon={<Clock className="h-3.5 w-3.5" />}
                    value={
                      veoMode === "perScene"
                        ? `${veoDuration}s / scene`
                        : `${veoDuration}s clip`
                    }
                    activeId={String(veoDuration)}
                    tooltip={
                      veoMode === "perScene"
                        ? "Seconds per scene. Total ≈ scenes × this."
                        : "Length of the single Veo clip."
                    }
                    options={veoDurations.map((d) => ({
                      id: String(d),
                      label:
                        veoMode === "perScene"
                          ? `${d} seconds / scene`
                          : `${d} seconds`,
                    }))}
                    onSelect={(id) => setVeoDuration(Number(id) as 4 | 6 | 8)}
                    disabled={loading || veoResolution === "1080p"}
                  />
                  <ChipDropdown
                    sheetTitle="Select resolution"
                    square
                    showChevron={false}
                    icon={<Maximize2 className="h-3.5 w-3.5" />}
                    value={veoResolution}
                    activeId={veoResolution}
                    tooltip="Video resolution. 1080p requires an 8s clip (Veo 3.1 Lite constraint)."
                    options={(["720p", "1080p"] as const).map((r) => ({
                      id: r,
                      label: r === "1080p" ? "1080p (8s only)" : "720p",
                    }))}
                    onSelect={(id) => onVeoResolution(id as VeoResolution)}
                    disabled={loading}
                  />
                  {veoMode === "single" ? (
                    <ChipDropdown
                      sheetTitle="Select prompt structure"
                      square
                      showChevron={false}
                      icon={<Film className="h-3.5 w-3.5" />}
                      value={singlePromptScenes === 2 ? "2 scenes / prompt" : "1 scene"}
                      activeId={String(singlePromptScenes)}
                      tooltip="How Gemini structures the single Veo prompt — still one generated video."
                      options={[
                        { id: "1", label: "1 continuous scene" },
                        { id: "2", label: "2 scenes + cut (one call)" },
                      ]}
                      onSelect={(id) => setSinglePromptScenes(Number(id) as 1 | 2)}
                      disabled={loading}
                    />
                  ) : (
                    <ChipDropdown
                      sheetTitle="Select scene count"
                      square
                      showChevron={false}
                      icon={<Layers className="h-3.5 w-3.5" />}
                      value={`${veoNumScenes} scene${veoNumScenes > 1 ? "s" : ""}`}
                      activeId={String(veoNumScenes)}
                      tooltip="Scene count multiplies with seconds-per-scene for total run time."
                      options={[1, 2, 3].map((n) => ({
                        id: String(n),
                        label: `${n} scene${n > 1 ? "s" : ""}`,
                      }))}
                      onSelect={(id) => setVeoNumScenes(Number(id))}
                      disabled={loading}
                    />
                  )}
                </>
              )}

              {/* Narrator: voice + emotion (shared) */}
              <ChipDropdown
                sheetTitle="Select narrator voice"
                square
                showChevron={false}
                icon={<Mic className="h-3.5 w-3.5" />}
                value={humanizeReelsVoice(voiceId)}
                activeId={voiceId}
                tooltip="The narrator's MiniMax voice."
                options={REELS_ENGLISH_VOICES.map((v) => ({
                  id: v,
                  label: humanizeReelsVoice(v),
                }))}
                onSelect={(id) => setVoiceId(id)}
                disabled={loading}
              />
              <ChipDropdown
                sheetTitle="Select delivery mood"
                square
                showChevron={false}
                icon={<Smile className="h-3.5 w-3.5" />}
                value={humanizeReelsEmotion(emotion)}
                activeId={emotion}
                tooltip={
                  engine === "veo"
                    ? 'Spoken delivery mood. "Auto" maps to neutral for Veo.'
                    : 'Spoken delivery mood. "Auto" lets the AI pick a mood for the theme.'
                }
                options={REELS_EMOTIONS.map((em) => ({
                  id: em,
                  label: humanizeReelsEmotion(em),
                }))}
                onSelect={(id) => setEmotion(id)}
                disabled={loading}
              />
            </div>

            <div className="hidden items-center gap-3 lg:flex">
              <CreditActionButton
                balance={balance}
                cost={cost}
                ready={canGenerate}
                loading={loading}
                label="Generate"
              />
              {loading && (
                <button
                  type="button"
                  onClick={() => cancelSubmit()}
                  disabled={cancelling}
                  className={CANCEL_BTN_CLASS}
                >
                  {cancelling ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Cancelling</span>
                    </>
                  ) : (
                    <span>Cancel</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Engine — attached under the form card on mobile only */}
        <StudioModelPanel>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-500">Engine</span>
            <ChipDropdown
              sheetTitle="Select engine"
              bare
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={reelsEngineLabel(engine)}
              activeId={engine}
              options={reelsEngines.map((e) => ({ id: e.id, label: e.label }))}
              onSelect={(id) => setEngine(id as ReelsEngine)}
              disabled={loading}
            />
          </div>
        </StudioModelPanel>

        {/* Generate (mobile — below the form card) */}
        <div className="mt-3 flex items-center gap-3 lg:hidden">
          <CreditActionButton
            balance={balance}
            cost={cost}
            ready={canGenerate}
            loading={loading}
            label="Generate"
            className={`${GENERATE_BTN_CLASS} flex-1`}
          />
          {loading && (
            <button
              type="button"
              onClick={() => cancelSubmit()}
              disabled={cancelling}
              className={CANCEL_BTN_CLASS}
            >
              {cancelling ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Cancelling</span>
                </>
              ) : (
                <span>Cancel</span>
              )}
            </button>
          )}
        </div>

        {/* Caption styler + live preview */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-400 sm:text-sm">
              <Type className="h-3.5 w-3.5 text-purple-300" />
              Caption style
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-gray-500">
                    Font family
                  </label>
                  <ThemedSelect
                    value={captionStyle.fontname}
                    options={REELS_CAPTION_FONTS}
                    onChange={(v) => setCaptionStyle({ ...captionStyle, fontname: v })}
                    disabled={loading}
                    previewFont
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-gray-500">
                    Font size
                  </label>
                  <NumberStepper
                    value={captionStyle.fontsize}
                    onChange={(v) => setCaptionStyle({ ...captionStyle, fontsize: v })}
                    min={8}
                    max={200}
                    step={2}
                    disabled={loading}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-gray-500">
                      Text color
                    </label>
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-1.5">
                      <input
                        type="color"
                        value={captionStyle.highlightColor}
                        onChange={(e) =>
                          setCaptionStyle({ ...captionStyle, highlightColor: e.target.value })
                        }
                        disabled={loading}
                        className="h-8 w-8 cursor-pointer rounded-lg border-none bg-transparent"
                      />
                      <span className="font-mono text-sm text-gray-300">
                        {captionStyle.highlightColor}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-gray-500">
                      Outline
                    </label>
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-1.5">
                      <input
                        type="color"
                        value={captionStyle.outlineColor}
                        onChange={(e) =>
                          setCaptionStyle({ ...captionStyle, outlineColor: e.target.value })
                        }
                        disabled={loading}
                        className="h-8 w-8 cursor-pointer rounded-lg border-none bg-transparent"
                      />
                      <span className="font-mono text-sm text-gray-300">
                        {captionStyle.outlineColor}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-gray-500">
                    Outline thickness
                  </label>
                  <NumberStepper
                    value={captionStyle.outlineThickness}
                    onChange={(v) =>
                      setCaptionStyle({ ...captionStyle, outlineThickness: v })
                    }
                    min={0}
                    max={20}
                    step={1}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-gray-500">
                      Vertical position
                    </label>
                    <span className="text-sm font-bold text-purple-300">
                      {captionStyle.marginV}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={captionStyle.marginV}
                    onChange={(e) =>
                      setCaptionStyle({ ...captionStyle, marginV: Number(e.target.value) })
                    }
                    disabled={loading}
                    className="w-full accent-purple-500"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-3 pt-1">
                  <input
                    type="checkbox"
                    checked={captionStyle.highlightOnly}
                    onChange={(e) =>
                      setCaptionStyle({ ...captionStyle, highlightOnly: e.target.checked })
                    }
                    disabled={loading}
                    className="h-4 w-4 cursor-pointer rounded border-white/10 bg-black/30 accent-purple-600"
                  />
                  <span className="text-sm font-semibold text-gray-300">
                    Highlight only mode
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Live Caption Preview — 480x854 math mirrors the server ASS MarginV. */}
          <div className="rounded-3xl border border-white/10 bg-black/40 p-4 sm:p-5">
            <div className="mb-3 text-center text-xs font-bold uppercase tracking-[0.3em] text-gray-500 sm:text-sm">
              Live caption preview
            </div>
            {engine === "veo" && (
              <p className="mx-auto mb-3 max-w-[240px] text-center text-sm leading-relaxed text-amber-400/80">
                Preview uses 480×854 math; Veo outputs 720p/1080p so vertical caption
                position may differ slightly.
              </p>
            )}
            <style
              dangerouslySetInnerHTML={{
                __html:
                  "@import url('https://fonts.googleapis.com/css2?family=Bangers&family=Montserrat:wght@700&family=Poppins:wght@800&display=swap');",
              }}
            />
            {(() => {
              const FONT_METRIC_SCALES: Record<string, number> = {
                Arial: 0.87,
                Poppins: 0.86,
                Montserrat: 0.86,
                Bangers: 0.65,
              };
              const DESCENDER_OFFSET_SCALES: Record<string, number> = {
                Arial: 0.08,
                Poppins: 0.08,
                Montserrat: 0.08,
                Bangers: 0.12,
              };
              const metricScale = FONT_METRIC_SCALES[captionStyle.fontname] || 0.85;
              const offsetScale = DESCENDER_OFFSET_SCALES[captionStyle.fontname] || 0.08;
              return (
                <div className="relative mx-auto aspect-[9/16] w-[220px] overflow-hidden rounded-[2rem] border-[6px] border-white/10 bg-slate-900 shadow-inner">
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60" />
                  <div
                    className="pointer-events-none absolute left-0 flex w-full justify-center px-4 transition-all duration-300"
                    style={{
                      bottom: `calc(${(captionStyle.marginV * (854 - captionStyle.fontsize * 1.5)) / 854}% + ${captionStyle.fontsize * (220 / 480) * offsetScale}px)`,
                    }}
                  >
                    <div
                      className="relative text-center font-extrabold uppercase leading-none tracking-tight"
                      style={{
                        fontFamily: `"${captionStyle.fontname}", sans-serif`,
                        fontSize: `${captionStyle.fontsize * (220 / 480) * metricScale}px`,
                      }}
                    >
                      <div
                        className="absolute inset-0 z-0"
                        style={{
                          WebkitTextStroke: `${captionStyle.outlineThickness * (220 / 480) * 1.5}px ${captionStyle.outlineColor}`,
                          color: captionStyle.outlineColor,
                        }}
                      >
                        BREATHTAKING
                      </div>
                      <div className="relative z-10" style={{ color: captionStyle.highlightColor }}>
                        BREATHTAKING
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </form>

      {error && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
          <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
          Writing the script, generating scenes, narration &amp; captions — this can take a
          few minutes. It will appear below when ready.
        </div>
      )}

      {resultUrl && !loading && (
        <div className="mt-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-4 sm:flex-row">
          <video
            src={resultUrl}
            controls
            playsInline
            className="w-full max-w-[260px] shrink-0 rounded-2xl border border-white/10 bg-black"
          />
          <div className="min-w-0 flex-1">
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
              <Check className="h-3 w-3" />
              Saved to your library
            </div>
            <p className="text-sm text-gray-300">
              {engine === "veo"
                ? `${reelsEngineLabel("veo")} · ${veoMode === "single" ? "Single" : "Per scene"} · ${veoResolution} · ${totalDuration}s`
                : `${reelsEngineLabel("seedance")} · ${numScenes} scene${numScenes > 1 ? "s" : ""} · ${resolution} · ${totalDuration}s`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={resultUrl}
                download
                className="inline-flex items-center gap-2 rounded-[4px] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                <Download className="h-4 w-4" />
                Download
              </a>
              <a
                href={`/tools/scheduler?assetUrl=${encodeURIComponent(resultPath ?? resultUrl ?? "")}${
                  theme.trim() ? `&title=${encodeURIComponent(theme.trim())}` : ""
                }`}
                className="inline-flex items-center gap-2 rounded-[4px] bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:bg-emerald-500"
              >
                <CalendarClock className="h-4 w-4" />
                Schedule to YouTube
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
