"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Camera,
  Sparkles,
  Image as ImageIcon,
  Zap,
  Upload,
  Wand2,
  Loader2,
  AlertCircle,
  User,
  Check,
  X,
} from "lucide-react";
import {
  MODEL_POSES,
  PHOTO_STYLES,
  PRODUCT_PHOTO_TIERS,
  DEFAULT_PRODUCT_PHOTO_TIER,
  DEFAULT_PRODUCT_PHOTO_RESOLUTION,
  getProductPhotoTier,
  ModelPoseId,
  PhotoStyleId,
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

// Translate the idempotency status codes into a user-facing message; null otherwise.
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

export default function ProductPhotoPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [productFile, setProductFile] = useState<File | null>(null);
  const [productPreview, setProductPreview] = useState<string | null>(null);
  const [poseId, setPoseId] = useState<ModelPoseId>("standing");
  const [styleId, setStyleId] = useState<PhotoStyleId>("minimalist-studio");
  const [modelTier, setModelTier] = useState<ProductPhotoModelTier>(DEFAULT_PRODUCT_PHOTO_TIER);
  const [resolution, setResolution] = useState<ProductPhotoResolution>(
    DEFAULT_PRODUCT_PHOTO_RESOLUTION
  );
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const { refetch: refetchCredits } = useCreditBalance();
  // Effective Product Photo price (v2.3): computed from the selected model tier
  // (+ resolution for balanced/pro) provider cost via the shared pricing math, so
  // the label always matches backend billing within the resolver cache window.
  const { imageCredits } = usePricing();
  const tier = getProductPhotoTier(modelTier);
  // Pricing key for the active tier+resolution combination.
  const selectedPricingKey = tier.hasResolution
    ? tier.resolutions.find((r) => r.id === resolution)?.pricingKey ??
      tier.resolutions[0].pricingKey
    : tier.basicPricingKey!;
  const photoCost = imageCredits(selectedPricingKey, 1);

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
    setResultUrl(null);
    setError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file?.type.startsWith("image/")) setFile(file);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productFile) return;
    if (loading) return;

    setLoading(true);
    setError(null);
    setWarning(null);

    try {
      const formData = new FormData();
      formData.append("image", productFile);
      formData.append("poseId", poseId);
      formData.append("styleId", styleId);
      formData.append("modelTier", modelTier);
      // Resolution is only meaningful for balanced/pro; Basic has no resolution
      // param (the server normalizes a missing value to null for Basic).
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

  const selectedPose = MODEL_POSES.find((p) => p.id === poseId);
  const selectedStyle = PHOTO_STYLES.find((s) => s.id === styleId);

  return (
    <div className="min-h-screen bg-[#030712] text-white selection:bg-purple-500/30">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-purple-900/20 rounded-full blur-[120px]" />
        <div className="absolute top-[20%] -right-[10%] w-[30%] h-[30%] bg-indigo-900/20 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-medium mb-4">
            <Sparkles className="w-3 h-3" />
            <span>AI Product Photography</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white to-gray-400">
            Model + product shots
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl">
            Upload your product, pick a model pose and scene style. Nano Banana places your product
            on a model in a professional lifestyle shot.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
          {/* Controls */}
          <form onSubmit={handleGenerate} className="space-y-6">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />

            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-3xl p-8 text-center transition-all cursor-pointer group ${
                dragOver
                  ? "border-purple-400 bg-purple-500/10"
                  : "border-white/10 bg-white/5 hover:border-purple-500/40 hover:bg-white/[0.07]"
              }`}
            >
              {productPreview ? (
                <div className="relative">
                  <div className="relative mx-auto w-40 h-40 rounded-2xl overflow-hidden border border-white/10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={productPreview}
                      alt="Product preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-black/80 border border-white/20 flex items-center justify-center hover:bg-red-500/80 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="w-16 h-16 bg-purple-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                    <Upload className="w-8 h-8 text-purple-400" />
                  </div>
                  <h3 className="text-lg font-medium mb-2 text-white">Upload product image</h3>
                  <p className="text-sm text-gray-400">PNG, JPG, or WebP — max 10MB</p>
                </>
              )}
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-purple-400 mb-3">
                <User className="w-4 h-4" />
                Model pose
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {MODEL_POSES.map((pose) => {
                  const active = poseId === pose.id;
                  return (
                    <button
                      key={pose.id}
                      type="button"
                      onClick={() => setPoseId(pose.id)}
                      disabled={loading}
                      className={`p-3 rounded-2xl border text-left text-sm font-medium transition-all ${
                        active
                          ? "bg-purple-500/20 border-purple-400/50 text-white"
                          : "bg-white/5 border-white/10 text-gray-300 hover:border-white/25"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        {pose.label}
                        {active && <Check className="w-4 h-4 text-purple-400 shrink-0" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-purple-400 mb-3">
                <Camera className="w-4 h-4" />
                Scene style
              </label>
              <div className="grid grid-cols-2 gap-3">
                {PHOTO_STYLES.map((style) => {
                  const active = styleId === style.id;
                  const icon =
                    style.id === "neon-tech" ? (
                      <Zap className="w-4 h-4" />
                    ) : style.id === "outdoor-lifestyle" ? (
                      <ImageIcon className="w-4 h-4" />
                    ) : style.id === "luxury-marble" ? (
                      <Sparkles className="w-4 h-4" />
                    ) : (
                      <Camera className="w-4 h-4" />
                    );
                  return (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => setStyleId(style.id)}
                      disabled={loading}
                      className={`flex items-center gap-3 p-4 rounded-2xl border transition-all text-left ${
                        active
                          ? "bg-purple-500/20 border-purple-400/50"
                          : "bg-white/5 border-white/10 hover:border-white/20"
                      }`}
                    >
                      <div
                        className={`p-2 rounded-lg ${active ? "bg-purple-500/30 text-purple-200" : "bg-white/5 text-gray-400"}`}
                      >
                        {icon}
                      </div>
                      <span className="text-sm font-medium">{style.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-purple-400 mb-3">
                <Sparkles className="w-4 h-4" />
                Model tier
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {PRODUCT_PHOTO_TIERS.map((t) => {
                  const active = modelTier === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setModelTier(t.id)}
                      disabled={loading}
                      className={`flex flex-col gap-1 p-4 rounded-2xl border text-left transition-all ${
                        active
                          ? "bg-purple-500/20 border-purple-400/50"
                          : "bg-white/5 border-white/10 hover:border-white/20"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-white">{t.label}</span>
                        {active && <Check className="w-4 h-4 text-purple-400 shrink-0" />}
                      </span>
                      <span className="text-xs text-gray-400">{t.subtitle}</span>
                      {t.hasResolution ? (
                        <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs font-medium text-purple-300">
                          {t.resolutions.map((r) => (
                            <span key={r.id}>
                              {r.label} {imageCredits(r.pricingKey, 1)}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-purple-300">
                          {imageCredits(t.basicPricingKey!, 1)} credits
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {tier.hasResolution ? (
              <div>
                <label className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-purple-400 mb-3">
                  <ImageIcon className="w-4 h-4" />
                  Resolution
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {tier.resolutions.map((r) => {
                    const active = resolution === r.id;
                    const cost = imageCredits(r.pricingKey, 1);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setResolution(r.id)}
                        disabled={loading}
                        className={`flex flex-col gap-1 p-4 rounded-2xl border text-left transition-all ${
                          active
                            ? "bg-purple-500/20 border-purple-400/50"
                            : "bg-white/5 border-white/10 hover:border-white/20"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-white">{r.label}</span>
                          {active && <Check className="w-4 h-4 text-purple-400 shrink-0" />}
                        </span>
                        <span className="text-xs font-medium text-purple-300">{cost} credits</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                No resolution option for Basic — single fixed output.
              </p>
            )}

            {warning && (
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{warning}</span>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !productFile}
              className="w-full py-4 bg-white text-black rounded-2xl font-semibold hover:bg-gray-200 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating with Nano Banana…
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5" />
                  Generate with model · {photoCost} credits
                </>
              )}
            </button>
          </form>

          {/* Preview */}
          <div className="lg:sticky lg:top-8">
            <div className="aspect-[4/5] rounded-[2.5rem] bg-white/5 border border-white/10 relative overflow-hidden">
              {resultUrl ? (
                <Image
                  src={resultUrl}
                  alt="Generated product photo"
                  fill
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
                  <div className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center mb-6 border border-white/10">
                    <ImageIcon className="w-10 h-10 text-gray-500" />
                  </div>
                  <h3 className="text-xl font-medium text-white mb-2">Preview</h3>
                  <p className="text-gray-400 text-sm">
                    {selectedPose?.label} · {selectedStyle?.label}
                  </p>
                </div>
              )}
              {loading && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                  <Loader2 className="w-10 h-10 animate-spin text-purple-400" />
                  <p className="text-sm text-gray-300">Creating your shot…</p>
                </div>
              )}
            </div>
          </div>

        </div>

        <CreationsHistory
          title="Your generations"
          description="Every successful product photo appears here. Click any photo to view it full size."
          tools={["product_photo"]}
          mediaType="image"
          refreshKey={historyRefreshKey}
          onSelect={(item) => setLightboxUrl(item.mediaUrl)}
        />
      </div>

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-4"
          role="presentation"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            className="absolute top-6 right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white z-[201] border-0 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxUrl(null);
            }}
            aria-label="Close"
          >
            <X className="w-6 h-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Product photo full size"
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}