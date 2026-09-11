"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clock,
  Cpu,
  Film,
  Layers,
  Loader2,
  Maximize2,
  Mic,
  Minus,
  Plus,
  Smile,
  Type,
} from "lucide-react";
import {
  ChipDropdown,
  CreditActionButton,
  GENERATE_BTN_CLASS,
  GenerationCancelButton,
  DevBlankTestToggle,
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
  filterReelsEngines,
  type VideoComposerKey,
  type VideoComposerEnablement,
} from "@/lib/video-composer-features";
import { creationTypeChipOptions } from "./shared";
import type { VideoCreationTypeOption } from "./types";

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
        className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-N0/30 p-2.5 text-left text-sm text-text-primary transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          open ? "border-white/30 bg-white/10" : "border-white/10 hover:border-white/25"
        }`}
      >
        <span style={previewFont ? { fontFamily: `"${value}", sans-serif` } : undefined}>
          {value}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-text-secondary transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-xl border border-white/10 bg-N50 p-1.5 shadow-2xl shadow-N0/50">
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
                  active ? "bg-white/15 text-text-primary" : "text-text-secondary hover:bg-white/5"
                }`}
                style={previewFont ? { fontFamily: `"${opt}", sans-serif` } : undefined}
              >
                {opt}
                {active && <Check className="h-4 w-4 shrink-0 text-text-secondary" />}
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
    <div className="flex items-stretch overflow-hidden rounded-xl border border-white/10 bg-N0/30 transition-colors focus-within:border-white/25">
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => set(value - step)}
        aria-label="Decrease"
        className="flex w-10 shrink-0 items-center justify-center text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
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
        className="w-full min-w-0 border-x border-white/10 bg-transparent p-2.5 text-center text-sm font-semibold text-text-primary focus:outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => set(value + step)}
        aria-label="Increase"
        className="flex w-10 shrink-0 items-center justify-center text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function ReelsCreatorComposer({
  creationTypes,
  isAdmin,
  devBlank,
  onDevBlankChange,
  composerEnablement,
  onSelectCreation,
  onGenerated,
}: {
  creationTypes: VideoCreationTypeOption[];
  isAdmin: boolean;
  devBlank: boolean;
  onDevBlankChange: (next: boolean) => void;
  composerEnablement: Record<VideoComposerKey, VideoComposerEnablement> | null;
  onSelectCreation: (id: string) => void;
  onGenerated: () => void;
}) {
  const { openPreviewFromResponse } = useStudioGenerationPreview();
  const reelsEngines = filterReelsEngines(REELS_ENGINES, composerEnablement);
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
    idempotencyScope: "video:reels",
    refetchCredits,
    refreshHistory: onGenerated,
    openPreviewFromResponse,
    resumeStillFailingMessage: "Editing still failing. Try again in a moment.",
  });

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

  // Restore what was typed before a gated Generate click sent the visitor
  // through sign-in — see lib/pending-form-draft.ts.
  useEffect(() => {
    const draft = consumePendingDraft<{
      theme?: string;
      engine?: ReelsEngine;
      veoMode?: ReelsVeoMode;
      numScenes?: number;
      durationPerScene?: number;
      resolution?: SeedanceResolution;
      veoDuration?: 4 | 6 | 8;
      veoResolution?: VeoResolution;
    }>(window.location.pathname);
    if (!draft) return;
    if (draft.theme) setTheme(draft.theme);
    if (draft.engine) setEngine(draft.engine);
    if (draft.veoMode) setVeoMode(draft.veoMode);
    if (draft.numScenes) setNumScenes(draft.numScenes);
    if (draft.durationPerScene) setDurationPerScene(draft.durationPerScene);
    if (draft.resolution) setResolution(draft.resolution);
    if (draft.veoDuration) setVeoDuration(draft.veoDuration);
    if (draft.veoResolution) setVeoResolution(draft.veoResolution);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const cost = devBlank ? 0 : videoCredits(pricingKey, totalDuration);

  const canGenerate = !loading && theme.trim().length > 0;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate) return;
    if (status !== "authenticated") {
      openSignInModal(undefined, {
        theme,
        engine,
        veoMode,
        numScenes,
        durationPerScene,
        resolution,
        veoDuration,
        veoResolution,
      });
      return;
    }

    const body: Record<string, unknown> = {
      ...(engine === "seedance"
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
          }),
      ...(devBlank ? { devBlank: true } : {}),
    };

    await submit(`reels-${engine}:${JSON.stringify(body)}`, (idempotencyKey) =>
      fetch("/api/generate-reels", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      }),
      {
        fallbackCost: cost,
        errorFallback: "Failed to generate video",
        recoverableMessage:
          "Scene videos finished but editing failed. Credits stay on hold — tap Try again.",
      },
    );
  };

  // Adaptive control chips per engine/mode.
  const veoDurations = veoResolution === "1080p" ? [8] : [4, 6, 8];

  return (
    <>
      <StudioForm mode="video" onSubmit={handleGenerate}>
        {/* Top-left chips: creation type + engine (+ Veo mode) */}
        <StudioFormHeader>
          <ChipDropdown
            sheetTitle="Select creation type"
            icon={<Layers className="h-3.5 w-3.5" />}
            value="Reels Creator"
            activeId="reels-creator"
            options={creationTypeChipOptions(creationTypes, isAdmin)}
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
        </StudioFormHeader>

        <StudioFormCard>
          {/* Theme */}
          <textarea
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="Describe your reel — e.g., The history of space exploration in 60 seconds. Our AI writes the script, scenes, narration, and captions."
            rows={3}
            disabled={loading}
            className="min-h-[64px] w-full resize-none bg-transparent text-base text-text-primary placeholder:text-text-disabled focus:outline-none"
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
                // The menu spells "auto" out as "Auto (let AI decide)"; the chip
                // keeps the short form so it stays the width of its neighbours.
                value={emotion === "auto" ? "Auto" : humanizeReelsEmotion(emotion)}
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

        {/* Engine — attached under the form card on mobile only */}
        <StudioModelPanel>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-text-disabled">Engine</span>
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

        {/* Caption styler + live preview */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-text-secondary sm:text-sm">
              <Type className="h-3.5 w-3.5 text-text-secondary" />
              Caption style
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-text-disabled">
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
                  <label className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-text-disabled">
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
                    <label className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-text-disabled">
                      Text color
                    </label>
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-N0/30 p-1.5">
                      <input
                        type="color"
                        value={captionStyle.highlightColor}
                        onChange={(e) =>
                          setCaptionStyle({ ...captionStyle, highlightColor: e.target.value })
                        }
                        disabled={loading}
                        className="h-8 w-8 cursor-pointer rounded-lg border-none bg-transparent"
                      />
                      <span className="font-mono text-sm text-text-secondary">
                        {captionStyle.highlightColor}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-text-disabled">
                      Outline
                    </label>
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-N0/30 p-1.5">
                      <input
                        type="color"
                        value={captionStyle.outlineColor}
                        onChange={(e) =>
                          setCaptionStyle({ ...captionStyle, outlineColor: e.target.value })
                        }
                        disabled={loading}
                        className="h-8 w-8 cursor-pointer rounded-lg border-none bg-transparent"
                      />
                      <span className="font-mono text-sm text-text-secondary">
                        {captionStyle.outlineColor}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-text-disabled">
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
                    <label className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-text-disabled">
                      Vertical position
                    </label>
                    <span className="text-sm font-bold text-text-secondary">
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
                    className="w-full accent-white"
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
                    className="h-4 w-4 cursor-pointer rounded border-white/10 bg-N0/30 accent-white"
                  />
                  <span className="text-sm font-semibold text-text-secondary">
                    Highlight only mode
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Live Caption Preview — 480x854 math mirrors the server ASS MarginV. */}
          <div className="rounded-3xl border border-white/10 bg-N0/40 p-4 sm:p-5">
            <div className="mb-3 text-center text-xs font-bold uppercase tracking-[0.3em] text-text-disabled sm:text-sm">
              Live caption preview
            </div>
            {engine === "veo" && (
              <p className="mx-auto mb-3 max-w-[240px] text-center text-sm leading-relaxed text-warning/80">
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
                <div className="relative mx-auto aspect-[9/16] w-[220px] overflow-hidden rounded-[2rem] border-[6px] border-white/10 bg-N50 shadow-inner">
                  <div className="absolute inset-0 bg-gradient-to-t from-N0 via-transparent to-transparent opacity-60" />
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
      </StudioForm>

      {recoverableJobId && (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <span>{error ?? "Editing failed. You can try again without an extra charge."}</span>
          </div>
          <button
            type="button"
            onClick={() => resumeRecoverable()}
            disabled={loading}
            className="rounded-xl bg-warning px-4 py-2 font-medium text-static-black transition hover:brightness-110 disabled:opacity-50"
          >
            Try again
          </button>
        </div>
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
          Writing the script, generating scenes, narration &amp; captions — this can take a
          few minutes. It will appear below when ready.
        </div>
      )}

    </>
  );
}
