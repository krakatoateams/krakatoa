"use client";

import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import {
  MODEL_POSES,
  PHOTO_STYLES,
  PRODUCT_PHOTO_TIERS,
  PHOTO_ASPECT_RATIOS,
  DEFAULT_PRODUCT_PHOTO_TIER,
  DEFAULT_PRODUCT_PHOTO_RESOLUTION,
  DEFAULT_PHOTO_ASPECT_RATIO,
  getProductPhotoTier,
  ModelPoseId,
  PhotoStyleId,
  PhotoAspectRatio,
  ProductPhotoModelTier,
  ProductPhotoResolution,
} from "@/lib/product-photo";
import CreationsHistory from "@/components/CreationsHistory";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { usePricing } from "@/app/(app)/pricing-context";

// Generation idempotency (Double-Charge Protection v1): one fresh key per submit
// attempt, sent as the Idempotency-Key header (never inside FormData). Not persisted.
function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

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
  { id: "avatar", label: "Avatar", available: false },
  { id: "social-post", label: "Social media post", available: false },
] as const;
type CreationTypeId = (typeof CREATION_TYPES)[number]["id"];

// Friendly model names for the model chip. Each maps 1:1 to a product-photo tier
// so selecting a model drives the same `modelTier` the backend already understands.
const MODEL_LABELS: Record<ProductPhotoModelTier, string> = {
  basic: "Nano Banana",
  balanced: "Nano Banana 2",
  pro: "Nano Banana Pro",
};

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

export default function PhotoOmniPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [productFile, setProductFile] = useState<File | null>(null);
  const [productPreview, setProductPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [creationType, setCreationType] = useState<CreationTypeId>("generate-any-image");
  const [poseId, setPoseId] = useState<ModelPoseId>("standing");
  const [styleId, setStyleId] = useState<PhotoStyleId>("minimalist-studio");
  const [modelTier, setModelTier] = useState<ProductPhotoModelTier>(DEFAULT_PRODUCT_PHOTO_TIER);
  const [resolution, setResolution] = useState<ProductPhotoResolution>(
    DEFAULT_PRODUCT_PHOTO_RESOLUTION
  );
  const [aspectRatio, setAspectRatio] = useState<PhotoAspectRatio>(DEFAULT_PHOTO_ASPECT_RATIO);
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
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
  const requiresProduct = creationSupported && !isImageMode;
  const promptRequired = isImageMode;
  const canGenerate =
    creationSupported &&
    (requiresProduct ? !!productFile : true) &&
    (promptRequired ? prompt.trim().length > 0 : true);

  useEffect(() => {
    return () => {
      if (productPreview) URL.revokeObjectURL(productPreview);
    };
  }, [productPreview]);

  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxUrl(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxUrl]);

  const setFile = (file: File | null) => {
    if (productPreview) URL.revokeObjectURL(productPreview);
    if (!file) {
      setProductFile(null);
      setProductPreview(null);
      return;
    }
    setProductFile(file);
    setProductPreview(URL.createObjectURL(file));
    setError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setFile(file);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !canGenerate) return;

    setLoading(true);
    setError(null);
    setWarning(null);

    try {
      const formData = new FormData();
      formData.append("mode", isImageMode ? "image" : "product");
      if (productFile) formData.append("image", productFile);
      formData.append("poseId", poseId);
      formData.append("styleId", styleId);
      formData.append("modelTier", modelTier);
      formData.append("aspectRatio", aspectRatio);
      if (prompt.trim()) formData.append("prompt", prompt.trim());
      if (tier.hasResolution) {
        formData.append("resolution", resolution);
      }

      const response = await fetch("/api/generate-photo", {
        method: "POST",
        headers: { "Idempotency-Key": newIdempotencyKey() },
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

      setResultUrl(data.imageUrl);
      if (data.warning) setWarning(data.warning);
      setHistoryRefreshKey((k) => k + 1);
      refetchCredits();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const openPicker = () => fileInputRef.current?.click();

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

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
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
              value={MODEL_LABELS[modelTier]}
              activeId={modelTier}
              options={PRODUCT_PHOTO_TIERS.map((t) => ({
                id: t.id,
                label: MODEL_LABELS[t.id],
                hint: t.hasResolution
                  ? `${imageCredits(t.resolutions[0].pricingKey, 1)}+`
                  : `${imageCredits(t.basicPricingKey!, 1)}`,
              }))}
              onSelect={(id) => setModelTier(id as ProductPhotoModelTier)}
              disabled={loading}
            />
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-colors focus-within:border-purple-400/40 sm:p-5">
            {/* Prompt row */}
            <div className="flex items-start gap-3">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  isImageMode
                    ? "Describe the image you want to generate…"
                    : "Describe what happens in the shot…"
                }
                rows={2}
                className="min-h-[48px] w-full resize-none bg-transparent text-base text-white placeholder:text-gray-500 focus:outline-none"
              />
              {requiresProduct && (
                <button
                  type="button"
                  onClick={openPicker}
                  className={`group relative flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-[4px] border text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                    productPreview
                      ? "border-purple-400/50"
                      : "border-white/10 bg-white/5 text-gray-400 hover:border-purple-400/50 hover:text-white"
                  }`}
                  title={productPreview ? "Change product image" : "Add product image"}
                >
                  {productPreview ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={productPreview}
                        alt="Product"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            setFile(null);
                            if (fileInputRef.current) fileInputRef.current.value = "";
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
                      <span>Product</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Controls row */}
            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              {/* Chip dropdowns */}
              <div className="flex flex-wrap items-center gap-2">
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
                {!isImageMode && (
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
          ) : requiresProduct && !productFile ? (
            <p className="mt-2 pl-1 text-xs text-gray-500">
              Attach a product image to enable generation.
            </p>
          ) : (
            promptRequired &&
            !prompt.trim() && (
              <p className="mt-2 pl-1 text-xs text-gray-500">
                Describe the image you want to generate.
              </p>
            )
          )}
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
            Creating your shot with {tier.label} — it will appear below when ready.
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
                {isImageMode
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
            onSelect={(item) => setLightboxUrl(item.mediaUrl)}
          />
        </div>
      </div>

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
