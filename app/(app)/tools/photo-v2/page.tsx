"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Camera,
  Plus,
  Wand2,
  Loader2,
  AlertCircle,
  User,
  Check,
  X,
  ChevronDown,
  Maximize2,
  Layers,
  Cpu,
  Crop,
  Upload,
  Users,
  Palette,
  VenusAndMars,
  Cake,
  Clapperboard,
  ArrowRight,
  Languages,
} from "lucide-react";
import type { CreationHistoryItem } from "@/lib/creations";
import MentionTextarea from "@/components/MentionTextarea";
import {
  parseMentionAssetsFromHistory,
  type MentionAsset,
} from "@/lib/mention-assets";
import {
  STORYBOARD_STYLE_KEYS,
  STORYBOARD_STYLE_LABELS,
  DEFAULT_STORYBOARD_STYLE,
  type StoryboardStyleKey,
  STORYBOARD_ASPECT_RATIOS,
  DEFAULT_STORYBOARD_ASPECT_RATIO,
  storyboardOrientationLabel,
  type StoryboardAspectRatio,
  STORYBOARD_LANGUAGES,
  DEFAULT_STORYBOARD_LANGUAGE,
  storyboardLanguageLabel,
  type StoryboardLanguageId,
} from "@/lib/storyboard-style";
import {
  MODEL_POSES,
  PHOTO_STYLES,
  PRODUCT_PHOTO_TIERS,
  PHOTO_ASPECT_RATIOS,
  CHARACTER_STYLES,
  CHARACTER_GENDERS,
  CHARACTER_AGES,
  DEFAULT_PRODUCT_PHOTO_TIER,
  DEFAULT_PRODUCT_PHOTO_RESOLUTION,
  DEFAULT_PHOTO_ASPECT_RATIO,
  DEFAULT_CHARACTER_STYLE,
  DEFAULT_CHARACTER_GENDER,
  DEFAULT_CHARACTER_AGE,
  getProductPhotoTier,
  tierSupportsMultiReference,
  ModelPoseId,
  PhotoStyleId,
  PhotoAspectRatio,
  CharacterStyleId,
  CharacterGenderId,
  CharacterAgeId,
  ProductPhotoModelTier,
  ProductPhotoResolution,
} from "@/lib/product-photo";
import CreationsHistory from "@/components/CreationsHistory";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { usePricing } from "@/app/(app)/pricing-context";
import { useIdempotentSubmit } from "@/lib/use-idempotent-submit";

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

// Creation types surfaced in the top-left chip. Only "product-tryon" is wired to a
// backend today; the others are placeholders ("as of now") and disable Generate.
const CREATION_TYPES = [
  { id: "generate-any-image", label: "Generate any image", available: true },
  { id: "product-tryon", label: "Product Try-on", available: true },
  { id: "character", label: "Character creation", available: true },
  { id: "storyboard", label: "Storyboard", available: true },
  { id: "social-post", label: "Social media post", available: false },
] as const;
type CreationTypeId = (typeof CREATION_TYPES)[number]["id"];

// First reference-capable model — the default we snap to when the user enters a
// mode that needs a product reference (Product Try-on) with a text-only model selected.
const FIRST_REFERENCE_TIER =
  PRODUCT_PHOTO_TIERS.find((t) => t.supportsReference)?.id ?? DEFAULT_PRODUCT_PHOTO_TIER;

type ChipOption = { id: string; label: string; hint?: string };

function ChipDropdown({
  icon,
  value,
  options,
  activeId,
  onSelect,
  disabled,
  square = false,
  showChevron = true,
}: {
  icon: React.ReactNode;
  value: string;
  options: ChipOption[];
  activeId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  square?: boolean;
  showChevron?: boolean;
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
        className={`flex h-10 items-center gap-2 border px-3 text-sm transition-colors disabled:opacity-40 ${
          square ? "rounded-[4px]" : "rounded-full"
        } ${
          open
            ? "border-purple-400/50 bg-purple-500/15 text-white"
            : "border-white/10 bg-white/5 text-gray-200 hover:border-white/25"
        }`}
      >
        <span className="text-purple-300">{icon}</span>
        <span className="font-semibold">{value}</span>
        {showChevron && (
          <ChevronDown
            className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020] p-1.5 shadow-2xl shadow-black/50">
          {options.map((opt) => {
            const active = opt.id === activeId;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onSelect(opt.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                  active ? "bg-purple-500/20 text-white" : "text-gray-300 hover:bg-white/5"
                }`}
              >
                <span className="flex items-center gap-2">
                  {opt.label}
                  {opt.hint && (
                    <span className="text-xs font-medium text-purple-300">{opt.hint}</span>
                  )}
                </span>
                {active && <Check className="h-4 w-4 shrink-0 text-purple-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ImageUpload = {
  file: File | null;
  preview: string | null;
  inputRef: React.RefObject<HTMLInputElement>;
  open: () => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  clear: () => void;
};

// Encapsulates one optional image slot: file state, object-URL preview lifecycle,
// hidden <input> ref, and open/clear helpers. Used for product, character, and
// reference uploads so each tile manages itself.
function useImageUpload(): ImageUpload {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const set = (next: File | null) => {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next ? URL.createObjectURL(next) : null;
    });
    setFile(next);
  };

  return {
    file,
    preview,
    inputRef,
    open: () => inputRef.current?.click(),
    onChange: (e) => {
      const next = e.target.files?.[0];
      if (next) set(next);
    },
    clear: () => {
      set(null);
      if (inputRef.current) inputRef.current.value = "";
    },
  };
}

// A 64×64 upload tile (PRODUCT / CHARACTER / REFERENCE). Shows the picked image
// with a clear button, or a "+ label" prompt when empty.
function UploadTile({
  label,
  upload,
  disabled,
}: {
  label: string;
  upload: ImageUpload;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={upload.open}
      disabled={disabled}
      className={`group relative flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-[4px] border text-[10px] font-semibold uppercase tracking-wide transition-colors ${
        upload.preview
          ? "border-purple-400/50"
          : "border-white/10 bg-white/5 text-gray-400 hover:border-purple-400/50 hover:text-white"
      }`}
      title={upload.preview ? `Change ${label.toLowerCase()} image` : `Add ${label.toLowerCase()} image`}
    >
      {upload.preview ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={upload.preview}
            alt={label}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              upload.clear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                upload.clear();
              }
            }}
            className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-500/80"
          >
            <X className="h-3 w-3" />
          </span>
        </>
      ) : (
        <>
          <Plus className="h-4 w-4" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

// Character slot for Product Try-on: shows the chosen image (uploaded OR a saved
// character) with a clear button, or a "+ Character" button that opens a small
// menu to either upload an image or pick a previously generated character.
function CharacterTile({
  preview,
  onUpload,
  onPick,
  onClear,
  disabled,
}: {
  preview: string | null;
  onUpload: () => void;
  onPick: () => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  if (preview) {
    return (
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[4px] border border-purple-400/50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt="Character" className="absolute inset-0 h-full w-full object-cover" />
        <span
          role="button"
          tabIndex={0}
          onClick={onClear}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onClear();
          }}
          className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-500/80"
        >
          <X className="h-3 w-3" />
        </span>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setMenuOpen((o) => !o)}
        className="group flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-[4px] border border-white/10 bg-white/5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 transition-colors hover:border-purple-400/50 hover:text-white"
        title="Add character"
      >
        <Plus className="h-4 w-4" />
        <span>Character</span>
      </button>
      {menuOpen && (
        <div className="absolute left-0 z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020] p-1.5 shadow-2xl shadow-black/50">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onUpload();
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-white/5"
          >
            <Upload className="h-4 w-4 text-purple-300" />
            Upload image
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onPick();
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-white/5"
          >
            <Users className="h-4 w-4 text-purple-300" />
            Use a saved character
          </button>
        </div>
      )}
    </div>
  );
}

// Storyboard sub-tool. Generates one six-panel storyboard sheet from a theme +
// style, then hands the user off to the Video studio (Storyboard to Video) to
// turn it into a clip. Self-contained so it doesn't tangle with the product /
// image / character form's interdependent state.
function StoryboardComposer({
  onSelectCreation,
}: {
  onSelectCreation: (id: string) => void;
}) {
  const router = useRouter();
  const { imageCredits } = usePricing();
  const { refetch: refetchCredits } = useCreditBalance();

  const [theme, setTheme] = useState("");
  const [style, setStyle] = useState<StoryboardStyleKey>(DEFAULT_STORYBOARD_STYLE);
  // Orientation chosen here is stored on the storyboard and re-used (locked) when
  // turning it into a video, so the clip never flips orientation on the user.
  const [aspect, setAspect] = useState<StoryboardAspectRatio>(DEFAULT_STORYBOARD_ASPECT_RATIO);
  // Spoken language for the dialogue/narration — default English. Stored on the
  // storyboard and re-used as the default when generating the video.
  const [language, setLanguage] = useState<StoryboardLanguageId>(DEFAULT_STORYBOARD_LANGUAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; id: string } | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  // @-mentions: tag saved characters / storyboards in the theme; their images are
  // passed to the storyboard image model as references.
  const [mentionAssets, setMentionAssets] = useState<MentionAsset[]>([]);
  const [mentions, setMentions] = useState<MentionAsset[]>([]);
  // Optional visual theme reference (mood, palette, aesthetic) — same pattern as
  // Photo studio's reference upload tile.
  const themeReference = useImageUpload();
  // Double-submit / double-charge guard (see lib/use-idempotent-submit.ts).
  const { begin: beginSubmit } = useIdempotentSubmit();

  // Load the assets that can be @-mentioned: saved characters + storyboards.
  const loadMentionAssets = useCallback(async () => {
    try {
      const res = await fetch(
        "/api/creations/history?tool=product_photo,storyboard&mediaType=image&limit=50"
      );
      const data = await res.json();
      setMentionAssets(parseMentionAssetsFromHistory((data.items ?? []) as CreationHistoryItem[]));
    } catch {
      setMentionAssets([]);
    }
  }, []);

  useEffect(() => {
    void loadMentionAssets();
  }, [loadMentionAssets, historyRefreshKey]);

  const cost = imageCredits("storyboard_gpt_image_2_auto_per_image", 1);
  const canGenerate = !loading && theme.trim().length > 0;

  const goToVideo = (id: string) => {
    if (!id) return;
    router.push(`/tools/video?type=storyboard&storyboardId=${encodeURIComponent(id)}`);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate) return;

    const fileSig = (f: File | null) =>
      f ? `${f.name}/${f.size}/${f.lastModified}` : "";
    const signature = [
      "storyboard",
      theme.trim(),
      style,
      aspect,
      language,
      fileSig(themeReference.file),
      mentions.map((m) => m.id).join(","),
    ].join("|");
    const attempt = beginSubmit(signature);
    if (!attempt) return;

    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("theme", theme.trim());
      formData.append("storyboardStyle", style);
      formData.append("aspectRatio", aspect);
      formData.append("language", language);
      if (themeReference.file) {
        formData.append("reference", themeReference.file);
      }
      if (mentions.length) {
        formData.append("referenceCreationIds", mentions.map((m) => m.id).join(","));
      }

      const response = await fetch("/api/generate-storyboard", {
        method: "POST",
        headers: { "Idempotency-Key": attempt.key },
        body: formData,
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
        throw new Error(data.error || "Failed to generate storyboard");
      }
      attempt.settle(true);
      setResult({
        url: typeof data.storyboardUrl === "string" ? data.storyboardUrl : "",
        id: typeof data.storyboardId === "string" ? data.storyboardId : "",
      });
      setHistoryRefreshKey((k) => k + 1);
      refetchCredits();
    } catch (err: unknown) {
      attempt.settle(false);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <input
        ref={themeReference.inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={themeReference.onChange}
      />
      <form onSubmit={handleGenerate} className="relative z-20 mt-[200px]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ChipDropdown
            icon={<Layers className="h-3.5 w-3.5" />}
            value="Storyboard"
            activeId="storyboard"
            options={CREATION_TYPES.map((c) => ({
              id: c.id,
              label: c.label,
              hint: c.available ? undefined : "Soon",
            }))}
            onSelect={onSelectCreation}
            disabled={loading}
          />
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-colors focus-within:border-purple-400/40 sm:p-5">
          <div className="flex items-start gap-3">
            <MentionTextarea
              value={theme}
              onChange={setTheme}
              mentions={mentions}
              onMentionsChange={setMentions}
              assets={mentionAssets}
              disabled={loading}
              placeholder="Describe your video concept — e.g. “A barista's morning routine opening a cozy café”. Type @ to reference a saved character or storyboard."
            />
            <UploadTile label="Theme" upload={themeReference} disabled={loading} />
          </div>

          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Generation properties */}
            <div className="flex flex-wrap items-center gap-2">
              <ChipDropdown
                square
                showChevron={false}
                icon={<Palette className="h-3.5 w-3.5" />}
                value={STORYBOARD_STYLE_LABELS[style]}
                activeId={style}
                options={STORYBOARD_STYLE_KEYS.map((k) => ({
                  id: k,
                  label: STORYBOARD_STYLE_LABELS[k],
                }))}
                onSelect={(id) => setStyle(id as StoryboardStyleKey)}
                disabled={loading}
              />
              <ChipDropdown
                square
                showChevron={false}
                icon={<Crop className="h-3.5 w-3.5" />}
                value={aspect}
                activeId={aspect}
                options={STORYBOARD_ASPECT_RATIOS.map((a) => ({
                  id: a,
                  label: a,
                  hint: storyboardOrientationLabel(a),
                }))}
                onSelect={(id) => setAspect(id as StoryboardAspectRatio)}
                disabled={loading}
              />
              <ChipDropdown
                square
                showChevron={false}
                icon={<Languages className="h-3.5 w-3.5" />}
                value={storyboardLanguageLabel(language)}
                activeId={language}
                options={STORYBOARD_LANGUAGES.map((l) => ({
                  id: l.id,
                  label: l.label,
                }))}
                onSelect={(id) => setLanguage(id as StoryboardLanguageId)}
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              disabled={!canGenerate}
              className="flex h-10 items-center justify-center gap-2 rounded-[4px] bg-gradient-to-r from-fuchsia-500 to-pink-500 px-6 text-sm font-bold uppercase tracking-wide text-white shadow-lg shadow-pink-500/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <span>Generate</span>
                  <Wand2 className="h-4 w-4" />
                  <span className="text-sm font-extrabold">{cost}</span>
                </>
              )}
            </button>
          </div>
        </div>
        <p className="mt-2 pl-1 text-xs text-gray-500">
          Generates one six-panel storyboard sheet — attach a theme reference for mood and palette, or type @ for saved assets. Turn it into a video next.
        </p>
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
          Drafting your six-panel storyboard — it will appear below when ready.
        </div>
      )}

      {result && result.url && !loading && (
        <div className="mt-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-4 sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.url}
            alt="Storyboard sheet"
            className="w-full max-w-md shrink-0 rounded-2xl border border-white/10 bg-black object-contain"
          />
          <div className="flex min-w-0 flex-col">
            <div className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
              <Check className="h-3 w-3" />
              Saved to your library
            </div>
            <p className="text-sm text-gray-300">
              {STORYBOARD_STYLE_LABELS[style]} · {aspect} {storyboardOrientationLabel(aspect)} · {storyboardLanguageLabel(language)} · six panels
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Happy with it? Turn this storyboard into a video.
            </p>
            <button
              type="button"
              onClick={() => goToVideo(result.id)}
              disabled={!result.id}
              className="mt-4 flex h-10 w-fit items-center justify-center gap-2 rounded-[4px] bg-gradient-to-r from-fuchsia-500 to-pink-500 px-5 text-sm font-bold uppercase tracking-wide text-white shadow-lg shadow-pink-500/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Clapperboard className="h-4 w-4" />
              <span>Create video</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Creation history — global library across every tool (videos, photos,
          characters, storyboards). Action-rich, no tab bar. */}
      <div className="mt-[120px]">
        <CreationsHistory
          title="Your creations"
          description="Everything you create appears here — videos, photos, characters, and storyboards."
          refreshKey={historyRefreshKey}
          showActions
          showMeta={false}
          limit={20}
        />
      </div>
    </>
  );
}

function PhotoOmniPage() {
  const searchParams = useSearchParams();
  // Deep-link: the Video → Storyboard empty state links here with ?type=storyboard
  // so we open the storyboard sub-tool preselected.
  const initialCreationType: CreationTypeId =
    searchParams.get("type") === "storyboard" ? "storyboard" : "generate-any-image";

  const product = useImageUpload();
  const character = useImageUpload();
  const reference = useImageUpload();
  // Product Try-on character chosen from previously generated characters.
  const [selectedCharacter, setSelectedCharacter] = useState<{
    id: string;
    url: string;
    name: string;
  } | null>(null);
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [savedCharacters, setSavedCharacters] = useState<CreationHistoryItem[]>([]);
  const [charactersLoading, setCharactersLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [creationType, setCreationType] = useState<CreationTypeId>(initialCreationType);
  const [poseId, setPoseId] = useState<ModelPoseId>("standing");
  const [styleId, setStyleId] = useState<PhotoStyleId>("minimalist-studio");
  const [modelTier, setModelTier] = useState<ProductPhotoModelTier>(DEFAULT_PRODUCT_PHOTO_TIER);
  const [resolution, setResolution] = useState<ProductPhotoResolution>(
    DEFAULT_PRODUCT_PHOTO_RESOLUTION
  );
  const [aspectRatio, setAspectRatio] = useState<PhotoAspectRatio>(DEFAULT_PHOTO_ASPECT_RATIO);
  const [characterStyle, setCharacterStyle] = useState<CharacterStyleId>(DEFAULT_CHARACTER_STYLE);
  const [characterGender, setCharacterGender] = useState<CharacterGenderId>(DEFAULT_CHARACTER_GENDER);
  const [characterAge, setCharacterAge] = useState<CharacterAgeId>(DEFAULT_CHARACTER_AGE);
  // Admin-controlled per-feature model enablement (null until loaded → code fallback).
  const [featureModels, setFeatureModels] = useState<Record<
    string,
    { enabledTiers: string[]; defaultTier: string | null }
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // @-mentions: tag saved characters / storyboards in the prompt; their images are
  // sent as references and their names are woven into the prompt.
  const [mentionAssets, setMentionAssets] = useState<MentionAsset[]>([]);
  const [mentions, setMentions] = useState<MentionAsset[]>([]);
  // Double-submit / double-charge guard (see lib/use-idempotent-submit.ts).
  const { begin: beginSubmit } = useIdempotentSubmit();
  const { refetch: refetchCredits } = useCreditBalance();
  const { imageCredits } = usePricing();

  const tier = getProductPhotoTier(modelTier);
  const selectedPricingKey = tier.hasResolution
    ? tier.resolutions.find((r) => r.id === resolution)?.pricingKey ?? tier.resolutions[0].pricingKey
    : tier.basicPricingKey!;
  const photoCost = imageCredits(selectedPricingKey, 1);

  const selectedPose = MODEL_POSES.find((p) => p.id === poseId);
  const selectedStyle = PHOTO_STYLES.find((s) => s.id === styleId);
  const selectedCreation = CREATION_TYPES.find((c) => c.id === creationType);
  const creationSupported = selectedCreation?.available ?? false;
  // "Generate any image" = text-to-image: no product reference, prompt-driven.
  const isImageMode = creationType === "generate-any-image";
  // "Character creation" = text-to-image turnaround sheet (one image, multiple angles).
  const isCharacterMode = creationType === "character";
  const requiresProduct = creationSupported && creationType === "product-tryon";
  // Reference image upload is only meaningful for reference-capable models, and only
  // in the no-product modes (Generate any image / Character creation).
  const allowReferenceUpload = (isImageMode || isCharacterMode) && tier.supportsReference;

  // Which creation feature the current mode maps to (matches the admin config +
  // generate-photo `mode`). Unsupported types fall through to "product" but the
  // form is disabled for those, so it never matters.
  const featureKey = isImageMode ? "image" : isCharacterMode ? "character" : "product";

  // Models usable in the current mode. When the admin enablement has loaded, use
  // its per-feature list (it already encodes capability + admin toggles). Before
  // it loads (or on API failure) fall back to the in-code capability rule so the
  // form is never empty.
  const enabledTierIds = featureModels?.[featureKey]?.enabledTiers ?? null;
  // Count every reference image the current request will send: product, an attached
  // character (Try-on), an uploaded reference (image/character modes), and any
  // @-mentioned asset. Mentions/references can only be honored by reference-capable
  // models, and more than one reference needs a multi-reference model — so hide the
  // models that would silently drop them.
  const mentionCount = mentions.length;
  const referenceImageCount =
    (requiresProduct ? 1 : 0) +
    (requiresProduct && (!!character.file || !!selectedCharacter) ? 1 : 0) +
    ((isImageMode || isCharacterMode) && !!reference.file ? 1 : 0) +
    mentionCount;
  const needsReferenceModel =
    requiresProduct ||
    ((isImageMode || isCharacterMode) && (mentionCount > 0 || !!reference.file));
  const needsMultiReferenceModel = referenceImageCount > 1;
  const availableTiers = PRODUCT_PHOTO_TIERS.filter(
    (t) =>
      (enabledTierIds
        ? enabledTierIds.includes(t.id)
        : isImageMode || isCharacterMode || t.supportsReference) &&
      (!needsReferenceModel || t.supportsReference) &&
      (!needsMultiReferenceModel || tierSupportsMultiReference(t))
  );
  const availableTierKey = availableTiers.map((t) => t.id).join(",");

  const canGenerate =
    creationSupported &&
    availableTiers.length > 0 &&
    (requiresProduct ? !!product.file : true) &&
    (isImageMode ? prompt.trim().length > 0 : true) &&
    // Character: need a description OR a usable reference image.
    (isCharacterMode
      ? prompt.trim().length > 0 || (allowReferenceUpload && !!reference.file)
      : true);

  // Load admin per-feature model enablement once.
  useEffect(() => {
    let active = true;
    fetch("/api/tools/photo/features")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data?.features) return;
        const map: Record<string, { enabledTiers: string[]; defaultTier: string | null }> = {};
        for (const f of data.features) {
          map[f.key] = { enabledTiers: f.enabledTiers ?? [], defaultTier: f.defaultTier ?? null };
        }
        setFeatureModels(map);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Keep the selected model valid for the current feature: if it isn't offered,
  // snap to the feature's default (admin-configured) or the first available model.
  useEffect(() => {
    if (availableTiers.length === 0) return;
    if (availableTiers.some((t) => t.id === modelTier)) return;
    const preferred = featureModels?.[featureKey]?.defaultTier;
    const next =
      (preferred && availableTiers.find((t) => t.id === preferred)?.id) ||
      availableTiers[0]?.id ||
      FIRST_REFERENCE_TIER;
    setModelTier(next as ProductPhotoModelTier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTierKey, featureKey, modelTier]);

  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxUrl(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxUrl]);

  const loadSavedCharacters = useCallback(async () => {
    setCharactersLoading(true);
    try {
      const res = await fetch(
        "/api/creations/history?tool=product_photo&mediaType=image&limit=100"
      );
      const data = await res.json();
      const all: CreationHistoryItem[] = data.items || [];
      setSavedCharacters(all.filter((i) => i.metadata?.creationKind === "character"));
    } catch {
      setSavedCharacters([]);
    } finally {
      setCharactersLoading(false);
    }
  }, []);

  const openCharacterPicker = () => {
    setCharacterPickerOpen(true);
    void loadSavedCharacters();
  };

  // Load the assets that can be @-mentioned: saved characters + storyboards.
  const loadMentionAssets = useCallback(async () => {
    try {
      const res = await fetch(
        "/api/creations/history?tool=product_photo,storyboard&mediaType=image&limit=50"
      );
      const data = await res.json();
      setMentionAssets(parseMentionAssetsFromHistory((data.items ?? []) as CreationHistoryItem[]));
    } catch {
      setMentionAssets([]);
    }
  }, []);

  // Load mentionable assets once, and refresh after each generation (a new
  // character/storyboard may have just been created).
  useEffect(() => {
    void loadMentionAssets();
  }, [loadMentionAssets, historyRefreshKey]);

  const chooseSavedCharacter = (item: CreationHistoryItem) => {
    const name =
      (typeof item.metadata?.characterName === "string" && item.metadata.characterName.trim()) ||
      item.title ||
      "Character";
    character.clear();
    setSelectedCharacter({ id: item.id, url: item.mediaUrl, name });
    setCharacterPickerOpen(false);
  };

  const clearCharacter = () => {
    character.clear();
    setSelectedCharacter(null);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !canGenerate) return;

    const mode = isCharacterMode ? "character" : isImageMode ? "image" : "product";
    // Signature mirrors every input the request depends on, including file
    // identities (the server hash ignores image bytes), so any change rotates the
    // key. Stable key + synchronous lock stop a double-click / retry double-charge.
    const fileSig = (f: File | null | undefined) =>
      f ? `${f.name}/${f.size}/${f.lastModified}` : "";
    const signature = [
      "photo-v2",
      mode,
      fileSig(requiresProduct ? product.file : null),
      fileSig(character.file),
      selectedCharacter?.id ?? "",
      fileSig(allowReferenceUpload ? reference.file : null),
      isCharacterMode ? characterName.trim() : "",
      isCharacterMode ? characterStyle : "",
      isCharacterMode ? characterGender : "",
      isCharacterMode ? characterAge : "",
      poseId,
      styleId,
      modelTier,
      isCharacterMode ? "2:3" : aspectRatio,
      prompt.trim(),
      mentions.map((m) => m.id).join(","),
      tier.hasResolution ? resolution : "",
    ].join("|");
    const attempt = beginSubmit(signature);
    if (!attempt) return;

    setLoading(true);
    setError(null);
    setWarning(null);

    try {
      const formData = new FormData();
      formData.append("mode", mode);
      if (requiresProduct && product.file) {
        formData.append("image", product.file);
        if (character.file) formData.append("character", character.file);
        else if (selectedCharacter) formData.append("characterCreationId", selectedCharacter.id);
      }
      if (allowReferenceUpload && reference.file) {
        formData.append("reference", reference.file);
      }
      if (isCharacterMode) {
        if (characterName.trim()) formData.append("characterName", characterName.trim());
        formData.append("style", characterStyle);
        formData.append("gender", characterGender);
        formData.append("age", characterAge);
      }
      formData.append("poseId", poseId);
      formData.append("styleId", styleId);
      formData.append("modelTier", modelTier);
      // Character creation has no aspect chip — it always uses a 2:3 portrait sheet.
      formData.append("aspectRatio", isCharacterMode ? "2:3" : aspectRatio);
      if (prompt.trim()) formData.append("prompt", prompt.trim());
      // @-mentioned assets (saved characters / storyboards) → reference images.
      if (mentions.length) {
        formData.append("referenceCreationIds", mentions.map((m) => m.id).join(","));
      }
      if (tier.hasResolution) {
        formData.append("resolution", resolution);
      }

      const response = await fetch("/api/generate-photo", {
        method: "POST",
        headers: { "Idempotency-Key": attempt.key },
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? photoCost}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Generation failed");
      }

      attempt.settle(true);
      setResultUrl(data.imageUrl);
      if (data.warning) setWarning(data.warning);
      setHistoryRefreshKey((k) => k + 1);
      refetchCredits();
    } catch (err: unknown) {
      attempt.settle(false);
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#030712] text-white selection:bg-purple-500/30">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-[10%] -top-[10%] h-[40%] w-[40%] rounded-full bg-purple-900/20 blur-[120px]" />
        <div className="absolute -right-[10%] top-[20%] h-[30%] w-[30%] rounded-full bg-indigo-900/20 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl px-6 py-12">
        <div className="mb-8">
          <h1 className="mb-3 bg-gradient-to-b from-white to-gray-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent">
            Photo studio
          </h1>
        </div>

        {creationType === "storyboard" ? (
          <StoryboardComposer
            onSelectCreation={(id) => setCreationType(id as CreationTypeId)}
          />
        ) : (
          <>
        <input
          ref={product.inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={product.onChange}
        />
        <input
          ref={character.inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            character.onChange(e);
            if (e.target.files?.[0]) setSelectedCharacter(null);
          }}
        />
        <input
          ref={reference.inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={reference.onChange}
        />

        {/* Omni-form composer */}
        <form onSubmit={handleGenerate} className="relative z-20 mt-[200px]">
          {/* Animated dot-grid spotlight behind the composer */}
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
              icon={<Layers className="h-3.5 w-3.5" />}
              value={selectedCreation?.label ?? "Creation"}
              activeId={creationType}
              options={CREATION_TYPES.map((c) => ({
                id: c.id,
                label: c.label,
                hint: c.available ? undefined : "Soon",
              }))}
              onSelect={(id) => setCreationType(id as CreationTypeId)}
              disabled={loading}
            />
            <ChipDropdown
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={tier.modelLabel}
              activeId={modelTier}
              options={availableTiers.map((t) => ({
                id: t.id,
                label: t.modelLabel,
                hint: t.hasResolution
                  ? `${imageCredits(t.resolutions[0].pricingKey, 1)}+`
                  : `${imageCredits(t.basicPricingKey!, 1)}`,
              }))}
              onSelect={(id) => setModelTier(id as ProductPhotoModelTier)}
              disabled={loading}
            />
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-colors focus-within:border-purple-400/40 sm:p-5">
            {/* Character name (Character creation only) */}
            {isCharacterMode && (
              <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3">
                <User className="h-4 w-4 shrink-0 text-purple-300" />
                <input
                  type="text"
                  value={characterName}
                  onChange={(e) => setCharacterName(e.target.value)}
                  placeholder="Name your character (optional)"
                  maxLength={80}
                  className="w-full bg-transparent text-sm font-semibold text-white placeholder:font-normal placeholder:text-gray-500 focus:outline-none"
                />
              </div>
            )}

            {/* Prompt row */}
            <div className="flex items-start gap-3">
              <MentionTextarea
                value={prompt}
                onChange={setPrompt}
                mentions={mentions}
                onMentionsChange={setMentions}
                assets={mentionAssets}
                disabled={loading}
                placeholder={
                  isCharacterMode
                    ? "Describe your character — type @ to reference a saved character…"
                    : isImageMode
                      ? "Describe the image — type @ to reference a saved character or storyboard…"
                      : "Describe the shot — type @ to reference a saved character or storyboard…"
                }
              />
              {requiresProduct && (
                <>
                  <UploadTile label="Product" upload={product} disabled={loading} />
                  <CharacterTile
                    preview={selectedCharacter?.url ?? character.preview}
                    onUpload={character.open}
                    onPick={openCharacterPicker}
                    onClear={clearCharacter}
                    disabled={loading}
                  />
                </>
              )}
              {allowReferenceUpload && (
                <UploadTile label="Reference" upload={reference} disabled={loading} />
              )}
            </div>

            {/* Controls row */}
            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              {/* Chip dropdowns */}
              <div className="flex flex-wrap items-center gap-2">
                {!isCharacterMode && (
                  <ChipDropdown
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
                )}
                {isCharacterMode && (
                  <>
                    <ChipDropdown
                      square
                      showChevron={false}
                      icon={<Palette className="h-3.5 w-3.5" />}
                      value={CHARACTER_STYLES.find((s) => s.id === characterStyle)?.label ?? "Style"}
                      activeId={characterStyle}
                      options={CHARACTER_STYLES.map((s) => ({ id: s.id, label: s.label }))}
                      onSelect={(id) => setCharacterStyle(id as CharacterStyleId)}
                      disabled={loading}
                    />
                    <ChipDropdown
                      square
                      showChevron={false}
                      icon={<VenusAndMars className="h-3.5 w-3.5" />}
                      value={CHARACTER_GENDERS.find((g) => g.id === characterGender)?.label ?? "Gender"}
                      activeId={characterGender}
                      options={CHARACTER_GENDERS.map((g) => ({ id: g.id, label: g.label }))}
                      onSelect={(id) => setCharacterGender(id as CharacterGenderId)}
                      disabled={loading}
                    />
                    <ChipDropdown
                      square
                      showChevron={false}
                      icon={<Cake className="h-3.5 w-3.5" />}
                      value={CHARACTER_AGES.find((a) => a.id === characterAge)?.label ?? "Age"}
                      activeId={characterAge}
                      options={CHARACTER_AGES.map((a) => ({ id: a.id, label: a.label }))}
                      onSelect={(id) => setCharacterAge(id as CharacterAgeId)}
                      disabled={loading}
                    />
                  </>
                )}
                {requiresProduct && (
                  <>
                    <ChipDropdown
                      square
                      showChevron={false}
                      icon={<User className="h-3.5 w-3.5" />}
                      value={selectedPose?.label ?? "Pose"}
                      activeId={poseId}
                      options={MODEL_POSES.map((p) => ({ id: p.id, label: p.label }))}
                      onSelect={(id) => setPoseId(id as ModelPoseId)}
                      disabled={loading}
                    />
                    <ChipDropdown
                      square
                      showChevron={false}
                      icon={<Camera className="h-3.5 w-3.5" />}
                      value={selectedStyle?.label ?? "Style"}
                      activeId={styleId}
                      options={PHOTO_STYLES.map((s) => ({ id: s.id, label: s.label }))}
                      onSelect={(id) => setStyleId(id as PhotoStyleId)}
                      disabled={loading}
                    />
                  </>
                )}
                {tier.hasResolution && (
                  <ChipDropdown
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
                )}
              </div>

              {/* Generate */}
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={loading || !canGenerate}
                  className="flex h-10 items-center justify-center gap-2 rounded-[4px] bg-gradient-to-r from-fuchsia-500 to-pink-500 px-6 text-sm font-bold uppercase tracking-wide text-white shadow-lg shadow-pink-500/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <span>Generate</span>
                      <Wand2 className="h-4 w-4" />
                      <span className="text-sm font-extrabold">{photoCost}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {!creationSupported ? (
            <p className="mt-2 pl-1 text-xs text-amber-300/80">
              {selectedCreation?.label} is coming soon — switch to Generate any image or Product
              Try-on.
            </p>
          ) : requiresProduct && !product.file ? (
            <p className="mt-2 pl-1 text-xs text-gray-500">
              Attach a product image to enable generation. Character image is optional.
            </p>
          ) : isCharacterMode ? (
            <p className="mt-2 pl-1 text-xs text-gray-500">
              Generates one turnaround sheet showing your character from multiple angles.
              {allowReferenceUpload ? " Reference image is optional." : ""}
            </p>
          ) : isImageMode && !prompt.trim() ? (
            <p className="mt-2 pl-1 text-xs text-gray-500">
              Describe the image you want to generate.
              {allowReferenceUpload ? " Reference image is optional." : ""}
            </p>
          ) : requiresProduct ? (
            <p className="mt-2 pl-1 text-xs text-gray-500">
              Character is optional — upload a model image or use one of your saved characters.
            </p>
          ) : allowReferenceUpload ? (
            <p className="mt-2 pl-1 text-xs text-gray-500">
              Reference image is optional — it guides the generated result.
            </p>
          ) : null}
        </form>

        {warning && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{warning}</span>
          </div>
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
            {isCharacterMode
              ? `Creating your character turnaround with ${tier.label} — it will appear below when ready.`
              : `Creating your shot with ${tier.label} — it will appear below when ready.`}
          </div>
        )}

        {resultUrl && !loading && (
          <div className="mt-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => setLightboxUrl(resultUrl)}
              className="group relative h-40 w-32 shrink-0 overflow-hidden rounded-2xl border border-white/10"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resultUrl}
                alt="Latest generation"
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
            </button>
            <div className="min-w-0">
              <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                <Check className="h-3 w-3" />
                Saved to your library
              </div>
              <p className="text-sm text-gray-300">
                {isCharacterMode
                  ? `Character${characterName.trim() ? ` · ${characterName.trim()}` : ""} · ${tier.label}`
                  : isImageMode
                    ? `Generated image · ${tier.label}`
                    : `${selectedPose?.label} · ${selectedStyle?.label} · ${tier.label}`}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Click the thumbnail to view full size, or generate another below.
              </p>
            </div>
          </div>
        )}

        {/* Image generation history */}
        <div className="mt-[150px]">
          <CreationsHistory
            title="Generation history"
            description="Every product photo you create appears here. Click any photo to view it full size."
            tools={["product_photo"]}
            mediaType="image"
            refreshKey={historyRefreshKey}
            showActions
            showMeta={false}
            limit={20}
          />
        </div>
          </>
        )}
      </div>

      {characterPickerOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Choose a saved character"
          onClick={() => setCharacterPickerOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-gray-950"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Users className="h-4 w-4 text-purple-300" />
                Choose a character
              </h3>
              <button
                type="button"
                onClick={() => setCharacterPickerOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {charactersLoading ? (
                <div className="flex items-center justify-center py-16 text-gray-500">
                  <Loader2 className="h-7 w-7 animate-spin" />
                </div>
              ) : savedCharacters.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-16 text-center">
                  <Users className="mx-auto mb-3 h-10 w-10 text-gray-600" />
                  <p className="text-sm text-gray-400">No saved characters yet.</p>
                  <p className="mt-1 text-xs text-gray-600">
                    Create one with the “Character creation” type, then reuse it here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {savedCharacters.map((item) => {
                    const name =
                      (typeof item.metadata?.characterName === "string" &&
                        item.metadata.characterName.trim()) ||
                      item.title ||
                      "Character";
                    const active = selectedCharacter?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => chooseSavedCharacter(item)}
                        className={`group overflow-hidden rounded-xl border text-left transition-colors ${
                          active
                            ? "border-purple-400/70 ring-2 ring-purple-400/30"
                            : "border-white/10 hover:border-purple-400/50"
                        }`}
                      >
                        <div className="relative aspect-square w-full bg-black/40">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.mediaUrl}
                            alt={name}
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        </div>
                        <p className="truncate px-2 py-1.5 text-[11px] font-medium text-white">
                          {name}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-4"
          role="presentation"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            className="absolute right-6 top-6 z-[201] cursor-pointer rounded-full border-0 bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxUrl(null);
            }}
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Product photo full size"
            className="max-h-[90vh] max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// useSearchParams() requires a Suspense boundary in the App Router. Wrap the page
// so the storyboard deep-link (?type=storyboard) reads cleanly.
export default function PhotoOmniPageWrapper() {
  return (
    <Suspense fallback={null}>
      <PhotoOmniPage />
    </Suspense>
  );
}
