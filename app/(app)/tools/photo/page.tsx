"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  History,
  User,
  Check,
  X,
} from "lucide-react";
import {
  MODEL_POSES,
  PHOTO_STYLES,
  ModelPoseId,
  PhotoStyleId,
  ProductPhotoHistoryItem,
} from "@/lib/product-photo";
import { getOrCreateClientId } from "@/lib/product-photo-client";
import {
  getLocalHistory,
  saveLocalHistoryItem,
} from "@/lib/product-photo-history-local";

function mergeHistory(
  remote: ProductPhotoHistoryItem[],
  local: ProductPhotoHistoryItem[]
): ProductPhotoHistoryItem[] {
  const seen = new Set<string>();
  const merged: ProductPhotoHistoryItem[] = [];
  for (const item of [...remote, ...local]) {
    const key = item.imageUrl || item.storagePath || item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

function buildHistoryItem(
  imageUrl: string,
  poseId: ModelPoseId,
  styleId: PhotoStyleId,
  id?: string
): ProductPhotoHistoryItem {
  const pose = MODEL_POSES.find((p) => p.id === poseId)!;
  const style = PHOTO_STYLES.find((s) => s.id === styleId)!;
  return {
    id: id ?? `gen_${Date.now()}`,
    imageUrl,
    poseId,
    styleId,
    poseLabel: pose.label,
    styleLabel: style.label,
    createdAt: new Date().toISOString(),
    storagePath: "",
  };
}

export default function ProductPhotoPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [clientId, setClientId] = useState("");
  const [productFile, setProductFile] = useState<File | null>(null);
  const [productPreview, setProductPreview] = useState<string | null>(null);
  const [poseId, setPoseId] = useState<ModelPoseId>("standing");
  const [styleId, setStyleId] = useState<PhotoStyleId>("minimalist-studio");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<ProductPhotoHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const loadHistory = useCallback(async (id: string) => {
    if (!id) return;
    setHistoryLoading(true);
    setHistoryError(null);
    const local = getLocalHistory(id);
    try {
      const res = await fetch(`/api/product-photo/history?clientId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load history");
      setHistory(mergeHistory(data.items || [], local));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load history";
      setHistoryError(message);
      setHistory(local);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = getOrCreateClientId();
    setClientId(id);
    loadHistory(id);
  }, [loadHistory]);

  useEffect(() => {
    return () => {
      if (productPreview) URL.revokeObjectURL(productPreview);
    };
  }, [productPreview]);

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
    if (!productFile || !clientId) return;

    setLoading(true);
    setError(null);
    setWarning(null);

    try {
      const formData = new FormData();
      formData.append("image", productFile);
      formData.append("clientId", clientId);
      formData.append("poseId", poseId);
      formData.append("styleId", styleId);

      const response = await fetch("/api/generate-photo", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Generation failed");
      }

      setResultUrl(data.imageUrl);
      if (data.warning) setWarning(data.warning);

      const item: ProductPhotoHistoryItem =
        data.historyItem ?? buildHistoryItem(data.imageUrl, poseId, styleId);

      saveLocalHistoryItem(clientId, item);
      setHistory((prev) => mergeHistory([item], prev));
      await loadHistory(clientId);
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
                  Generate with model
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

        {/* History — full width below generator */}
        <section className="mt-16 pt-12 border-t border-white/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <History className="w-6 h-6 text-purple-400" />
                Your generations
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Every successful generation appears here. Click an image to preview it above.
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadHistory(clientId)}
              disabled={historyLoading || !clientId}
              className="text-sm px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:border-white/20 transition-colors disabled:opacity-50 shrink-0"
            >
              {historyLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {historyError && (
            <p className="text-sm text-amber-400/90 mb-6">
              {historyError} Showing items saved in this browser.
            </p>
          )}

          {historyLoading && history.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] py-20 text-center">
              <ImageIcon className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">No generations yet. Create your first shot above.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {history.map((item) => (
                <button
                  key={`${item.id}-${item.imageUrl}`}
                  type="button"
                  onClick={() => {
                    setResultUrl(item.imageUrl);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className={`text-left rounded-2xl overflow-hidden border transition-all hover:scale-[1.02] ${
                    resultUrl === item.imageUrl
                      ? "border-purple-400/60 ring-2 ring-purple-400/30"
                      : "border-white/10 hover:border-white/25"
                  }`}
                >
                  <div className="relative aspect-[4/5] w-full bg-black/40">
                    <Image
                      src={item.imageUrl}
                      alt={`${item.poseLabel} - ${item.styleLabel}`}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <div className="p-3 bg-white/[0.04]">
                    <p className="text-xs font-medium text-white truncate">
                      {item.poseLabel} · {item.styleLabel}
                    </p>
                    <p className="text-[10px] text-gray-500 mt-1">
                      {new Date(item.createdAt).toLocaleString()}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}