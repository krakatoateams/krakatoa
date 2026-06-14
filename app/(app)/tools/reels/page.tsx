"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Video, Settings, Play, Download, Sparkles, AlertCircle, Loader2, RefreshCw, Layers, Clock, Monitor, Mic, Smile, LayoutGrid, X, CalendarClock } from "lucide-react";
import CreationsHistory from "@/components/CreationsHistory";
import { seedancePricingKey, veoPricingKey } from "@/lib/pricing-math";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { usePricing } from "@/app/(app)/pricing-context";

// Generation idempotency (Double-Charge Protection v1): one fresh key per submit
// attempt, sent as the Idempotency-Key header. Not persisted anywhere — a browser/
// network retry of the SAME in-flight request reuses it; a new submit gets a new key.
function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

// Translate the idempotency status codes into a user-facing message. Returns null
// when the response is not an idempotency signal (so callers fall through).
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

// MiniMax speech-02-turbo: English voice catalogue. Keep the most useful for
// narration first so the default lands on a strong storytelling voice.
const ENGLISH_VOICES = [
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

const EMOTIONS = ["auto", "happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "fluent", "neutral"];

const humanizeVoice = (id: string) =>
  id.replace(/^English_/, '')
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());

const humanizeEmotion = (e: string) => e === "auto" ? "Auto (let AI decide)" : e.charAt(0).toUpperCase() + e.slice(1);

type StoryboardRow = {
  id: string;
  created_at: string;
  theme: string;
  storyboard_url: string;
  seedance_prompt: string;
  scene_breakdown: unknown;
  status: string | null;
  video_url: string | null;
  storyboard_style?: string | null;
};

const STORYBOARD_STYLE_OPTIONS = [
  { value: "cinematic_sketch", label: "Cinematic Sketch" },
  { value: "painterly_color", label: "Painterly Color" },
  { value: "comic_book", label: "Comic Book" },
  { value: "photorealistic", label: "Photorealistic" },
  { value: "anime_manga", label: "Anime / Manga" },
] as const;

function storyboardStyleDisplayName(
  style: string | null | undefined
): string {
  const key = style ?? "cinematic_sketch";
  const found = STORYBOARD_STYLE_OPTIONS.find((o) => o.value === key);
  return found?.label ?? "Cinematic Sketch";
}

export default function ReelsPage() {
  const [theme, setTheme] = useState("");
  const [numScenes, setNumScenes] = useState(1);
  const [durationPerScene, setDurationPerScene] = useState(5);
  const [resolution, setResolution] = useState("480p");
  const [voiceId, setVoiceId] = useState("English_CaptivatingStoryteller");
  const [emotion, setEmotion] = useState("auto");
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  
  const [testAudioPredictionId, setTestAudioPredictionId] = useState("g99vpsrf3hrmr0cy1jvtwy72cw");
  const [testVideoPredictionId, setTestVideoPredictionId] = useState("qxhe8d8dqhrmr0cy1jvryg745r");
  
  const [captionStyle, setCaptionStyle] = useState({
    fontname: "Poppins",
    fontsize: 60,
    primaryColor: "#FFFFFF",
    highlightColor: "#FFFF00",
    outlineColor: "#000000",
    outlineThickness: 4,
    marginV: 15,
    highlightOnly: true
  });

  const [engineTab, setEngineTab] = useState<"storyboard" | "veo" | "seedance">("storyboard");
  const [storyboardTheme, setStoryboardTheme] = useState("");
  const [storyboardStyle, setStoryboardStyle] = useState<string>("cinematic_sketch");
  const [storyboardStyleFilter, setStoryboardStyleFilter] = useState<string>("all");
  const [storyboardUrl, setStoryboardUrl] = useState<string | null>(null);
  const [storyboardId, setStoryboardId] = useState<string | null>(null);
  const [storyboards, setStoryboards] = useState<StoryboardRow[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [videoJobStoryboardId, setVideoJobStoryboardId] = useState<string | null>(null);
  const [storyboardLoading, setStoryboardLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  /** Last successful `videoUrl` is 16:9 storyboard Seedance (not vertical Reels). */
  const [resultIsStoryboardFormat, setResultIsStoryboardFormat] = useState(false);
  const [veoMode, setVeoMode] = useState<"single" | "perScene">("single");
  const [veoDuration, setVeoDuration] = useState<4 | 6 | 8>(6);
  const [veoResolution, setVeoResolution] = useState<"720p" | "1080p">("720p");
  const [singlePromptScenes, setSinglePromptScenes] = useState<1 | 2>(1);
  const [veoNumScenes, setVeoNumScenes] = useState(1);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const { refetch: refetchCredits } = useCreditBalance();
  // Effective pricing (Pricing Config v2.2): the resolver-backed billing settings
  // and per-tier provider costs are fetched once on mount. Labels compute through
  // the SAME shared pricing math the server bills with (videoCredits/imageCredits),
  // so the on-screen cost matches the charge within the ~60s cache window. For any
  // key not yet fetched the context falls back to the built-in v2 defaults.
  const { videoCredits, imageCredits } = usePricing();

  // Storyboard-to-video resolution (Pricing Config v2.2). Drives the Seedance
  // per-second pricing tier for the fixed 15s clip. Default 480p (lower cost).
  // This one is for the ACTIVE storyboard preview (single, just-generated board).
  const [storyboardVideoResolution, setStoryboardVideoResolution] = useState<"480p" | "720p">("480p");
  // Per-card resolution for the Storyboard GALLERY (each saved card chooses its
  // own 480p/720p independently). Keyed by storyboard id; missing = default 480p.
  const [galleryVideoResolution, setGalleryVideoResolution] = useState<
    Record<string, "480p" | "720p">
  >({});

  // Credit cost previews — provider-cost based. Video totals the duration first,
  // then converts to credits with a single final ceil (no per-second rounding).
  // Inputs are coerced defensively so labels never show NaN or a misleading 0.
  const seedanceCost = useMemo(
    () =>
      videoCredits(
        seedancePricingKey(resolution),
        Math.max(1, Number(numScenes) || 1) * Math.max(1, Number(durationPerScene) || 5)
      ),
    [numScenes, durationPerScene, resolution, videoCredits]
  );
  const veoCost = useMemo(() => {
    const dur = Math.max(1, Number(veoDuration) || 6);
    const sceneCount =
      veoMode === "single" ? 1 : Math.min(3, Math.max(1, Number(veoNumScenes) || 1));
    // Mirror the route: single mode bills the clip duration; perScene multiplies
    // by the (clamped) scene count.
    return videoCredits(veoPricingKey(veoResolution), dur * sceneCount);
  }, [veoMode, veoDuration, veoNumScenes, veoResolution, videoCredits]);
  const storyboardImageCost = imageCredits("storyboard_gpt_image_2_auto_per_image", 1);
  // 15s fixed clip priced via the Seedance tier for the selected resolution.
  const storyboardVideoCost = videoCredits(
    seedancePricingKey(storyboardVideoResolution),
    15
  );

  const fetchStoryboards = useCallback(async () => {
    try {
      const res = await fetch("/api/storyboards");
      const data = await res.json();
      if (!res.ok) {
        console.error("[Storyboard gallery]", data.error);
        return;
      }
      setStoryboards((data.storyboards as StoryboardRow[]) ?? []);
    } catch (err) {
      console.error("[Storyboard gallery]", err);
    }
  }, []);

  useEffect(() => {
    void fetchStoryboards();
  }, [fetchStoryboards]);

  useEffect(() => {
    if (engineTab !== "storyboard") setLightboxUrl(null);
  }, [engineTab]);

  const filteredStoryboardGalleryRows = useMemo(() => {
    if (storyboardStyleFilter === "all") return storyboards;
    return storyboards.filter(
      (r) =>
        (r.storyboard_style ?? "cinematic_sketch") === storyboardStyleFilter
    );
  }, [storyboards, storyboardStyleFilter]);

  const playStoryboardVideo = (videoUrl: string) => {
    setVideoUrl(videoUrl);
    setResultIsStoryboardFormat(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resolveEmotionForVeo = () => (emotion === "auto" ? "neutral" : emotion);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!theme.trim()) return;
    if (loading) return;

    setLoading(true);
    setError(null);
    setVideoUrl(null);
    setResultIsStoryboardFormat(false);
    setLogs(["Starting generation pipeline..."]);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": newIdempotencyKey(),
        },
        body: JSON.stringify({
          theme,
          numScenes: Number(numScenes),
          durationPerScene: Number(durationPerScene),
          resolution,
          voiceId,
          emotion,
          captionStyle
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? seedanceCost}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Failed to generate video");
      }

      setVideoUrl(data.videoUrl);
      setHistoryRefreshKey((k) => k + 1);
      refetchCredits();
      setLogs((prev) => [...prev, "Video generated successfully!"]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
      setLogs((prev) => [...prev, `Error: ${message}`]);
    } finally {
      setLoading(false);
    }
  };

  const handleVeoGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!theme.trim()) return;
    if (loading) return;

    setLoading(true);
    setError(null);
    setVideoUrl(null);
    setResultIsStoryboardFormat(false);
    setLogs(["Starting Veo generation pipeline..."]);

    try {
      if (veoResolution === "1080p" && veoDuration !== 8) {
        throw new Error("1080p requires 8 second duration.");
      }
      const emotionForApi = resolveEmotionForVeo();
      const payload: Record<string, unknown> = {
        theme,
        captionStyle,
        voiceId,
        emotion: emotionForApi,
        duration: veoDuration,
        resolution: veoResolution,
        mode: veoMode === "single" ? "single" : "perScene",
      };
      if (veoMode === "single") {
        payload.singlePromptScenes = singlePromptScenes;
      } else {
        payload.numScenes = Number(veoNumScenes);
      }

      const response = await fetch("/api/generate-veo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": newIdempotencyKey(),
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? veoCost}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Failed to generate video");
      }
      setVideoUrl(data.videoUrl);
      setHistoryRefreshKey((k) => k + 1);
      refetchCredits();
      setLogs((prev) => [...prev, "Veo pipeline completed successfully!"]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
      setLogs((prev) => [...prev, `Error: ${message}`]);
    } finally {
      setLoading(false);
    }
  };

  const onFormSubmit = (e: React.FormEvent) => {
    if (engineTab === "storyboard") {
      e.preventDefault();
      return;
    }
    if (engineTab === "seedance") {
      void handleGenerate(e);
    } else {
      void handleVeoGenerate(e);
    }
  };

  const handleGenerateStoryboard = async () => {
    if (!storyboardTheme.trim()) return;
    if (storyboardLoading || videoLoading) return;
    setStoryboardLoading(true);
    setError(null);
    setVideoUrl(null);
    setResultIsStoryboardFormat(false);
    setStoryboardId(null);
    setLogs(["GPT-5: 6-scene breakdown + Seedance prompt, then storyboard image (GPT Image 2)..."]);
    try {
      const response = await fetch("/api/generate-storyboard", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": newIdempotencyKey(),
        },
        body: JSON.stringify({ theme: storyboardTheme, storyboardStyle }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? storyboardImageCost}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Failed to generate storyboard");
      }
      setStoryboardUrl(
        typeof data.storyboardUrl === "string" ? data.storyboardUrl : null
      );
      setStoryboardId(typeof data.storyboardId === "string" ? data.storyboardId : null);
      setLogs((prev) => [...prev, "Storyboard saved — Create Video when ready."]);
      setHistoryRefreshKey((k) => k + 1);
      refetchCredits();
      await fetchStoryboards();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
      setLogs((prev) => [...prev, `Error: ${message}`]);
    } finally {
      setStoryboardLoading(false);
    }
  };

  const runStoryboardVideoJob = async (id: string, resolution: "480p" | "720p") => {
    if (videoLoading) return;
    setVideoLoading(true);
    setVideoJobStoryboardId(id);
    setError(null);
    setVideoUrl(null);
    setResultIsStoryboardFormat(false);
    setLogs((prev) => [
      ...prev,
      `Starting Seedance (${resolution}) for storyboard ${id.slice(0, 8)}…`,
    ]);
    // Cost preview for THIS job's resolution — used only in the 402 fallback msg.
    const requiredFallback = videoCredits(seedancePricingKey(resolution), 15);
    try {
      const response = await fetch("/api/generate-storyboard-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": newIdempotencyKey(),
        },
        body: JSON.stringify({ storyboardId: id, resolution }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? requiredFallback}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Failed to generate video");
      }
      setVideoUrl(data.videoUrl);
      setResultIsStoryboardFormat(true);
      setLogs((prev) => [...prev, "Storyboard video saved — playback ready."]);
      setHistoryRefreshKey((k) => k + 1);
      refetchCredits();
      await fetchStoryboards();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
      setLogs((prev) => [...prev, `Error: ${message}`]);
    } finally {
      setVideoLoading(false);
      setVideoJobStoryboardId(null);
    }
  };

  const handleCreateStoryboardVideo = async () => {
    if (!storyboardId) return;
    await runStoryboardVideoJob(storyboardId, storyboardVideoResolution);
  };

  const handleGalleryCreateVideo = (id: string) => {
    void runStoryboardVideoJob(id, galleryVideoResolution[id] ?? "480p");
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#030712] text-white font-sans selection:bg-indigo-500/30 overflow-x-hidden">
      {/* Background Glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full"></div>
      </div>

      {/* Navbar */}
      <header className="w-full h-20 flex items-center justify-center sticky top-0 z-50 px-6 backdrop-blur-md border-b border-white/5 bg-black/20">
        <div className="max-w-7xl w-full flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group text-slate-400 hover:text-white transition-all">
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
            <span className="text-sm font-bold tracking-tight">Back to Krakatoa</span>
          </Link>
          
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Video className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-black tracking-tighter">ReelsGen</span>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-grow py-12 px-6">
        <div className="max-w-7xl mx-auto">
          {/* Header Section */}
          <div className="mb-12">
            <h1 className="text-4xl md:text-5xl font-black mb-4 tracking-tight">Reels Generator</h1>
            <p className="text-slate-400 text-lg max-w-2xl">
              Turn your ideas into viral vertical content. Our AI handles the script, scenes, narration, and captions.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setEngineTab("storyboard")}
                className={`px-6 py-3 rounded-xl font-bold text-sm transition-all border ${
                  engineTab === "storyboard"
                    ? "bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                    : "bg-white/5 border-white/10 text-slate-400 hover:border-white/20"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <LayoutGrid className="w-4 h-4 shrink-0" />
                  Storyboard
                </span>
              </button>
              <button
                type="button"
                onClick={() => setEngineTab("veo")}
                className={`px-6 py-3 rounded-xl font-bold text-sm transition-all border ${
                  engineTab === "veo"
                    ? "bg-violet-600 border-violet-500 text-white shadow-lg shadow-violet-500/20"
                    : "bg-white/5 border-white/10 text-slate-400 hover:border-white/20"
                }`}
              >
                Veo
              </button>
              <button
                type="button"
                onClick={() => setEngineTab("seedance")}
                className={`px-6 py-3 rounded-xl font-bold text-sm transition-all border ${
                  engineTab === "seedance"
                    ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20"
                    : "bg-white/5 border-white/10 text-slate-400 hover:border-white/20"
                }`}
              >
                Seedance
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            {/* Left Column: Form Controls (7 cols) */}
            <div className="lg:col-span-7 space-y-8">
              <form onSubmit={onFormSubmit} className="space-y-8">
                {/* Theme Input */}
                <div className="space-y-4">
                  <label className="block text-sm font-bold uppercase tracking-widest text-indigo-400">Video Theme</label>
                  <div className="relative group">
                    {engineTab === "storyboard" ? (
                      <input
                        type="text"
                        value={storyboardTheme}
                        onChange={(e) => setStoryboardTheme(e.target.value)}
                        placeholder="e.g., A coffee shop reunion — 15s cinematic beat"
                        className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all placeholder:text-slate-600 group-hover:bg-white/[0.08]"
                        disabled={storyboardLoading || videoLoading}
                      />
                    ) : (
                      <input
                        type="text"
                        value={theme}
                        onChange={(e) => setTheme(e.target.value)}
                        placeholder="e.g., The history of space exploration in 60 seconds"
                        required
                        className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all placeholder:text-slate-600 group-hover:bg-white/[0.08]"
                        disabled={loading}
                      />
                    )}
                    <Sparkles className="absolute right-5 top-5 w-6 h-6 text-indigo-500/50 group-hover:text-indigo-400 transition-colors" />
                  </div>
                </div>

                {engineTab === "storyboard" && (
                  <div className="space-y-3">
                    <label className="block text-sm font-bold uppercase tracking-widest text-emerald-400/90">
                      Storyboard Style
                    </label>
                    <select
                      value={storyboardStyle}
                      onChange={(e) => setStoryboardStyle(e.target.value)}
                      disabled={storyboardLoading || videoLoading}
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 cursor-pointer text-slate-200"
                    >
                      {STORYBOARD_STYLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-[#030712]">
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {engineTab === "storyboard" && (
                  <div className="space-y-6 bg-white/[0.03] border border-emerald-500/20 rounded-[2rem] p-8">
                    <p className="text-sm text-slate-400 leading-relaxed">
                      Generate a six-panel storyboard image, review it, then create a <strong className="text-slate-200">15s 16:9</strong> clip with native audio (Seedance + GPT-5 prompt).
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleGenerateStoryboard()}
                      disabled={storyboardLoading || videoLoading || !storyboardTheme.trim()}
                      className="w-full py-4 rounded-2xl text-lg font-bold transition-all shadow-xl flex items-center justify-center gap-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:scale-[1.01] shadow-emerald-500/20 disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed"
                    >
                      {storyboardLoading ? (
                        <>
                          <Loader2 className="w-6 h-6 animate-spin" />
                          Creating your storyboard...
                        </>
                      ) : (
                        <>
                          <LayoutGrid className="w-6 h-6" />
                          Generate Storyboard · {storyboardImageCost} credits
                        </>
                      )}
                    </button>
                    {storyboardUrl && (
                      <div className="space-y-4">
                        <div className="rounded-2xl overflow-hidden border border-white/10 bg-black/40">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={storyboardUrl}
                            alt="Generated storyboard"
                            className="w-full h-auto object-contain max-h-[480px] mx-auto"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                            <Monitor className="w-4 h-4 text-emerald-400" />
                            Video quality
                          </div>
                          <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5">
                            {(["480p", "720p"] as const).map((res) => (
                              <button
                                key={res}
                                type="button"
                                onClick={() => setStoryboardVideoResolution(res)}
                                disabled={videoLoading}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all disabled:opacity-40 ${
                                  storyboardVideoResolution === res
                                    ? "bg-emerald-600 text-white"
                                    : "text-slate-400 hover:text-white"
                                }`}
                              >
                                {res}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3">
                          <button
                            type="button"
                            onClick={() => void handleGenerateStoryboard()}
                            disabled={storyboardLoading || videoLoading || !storyboardTheme.trim()}
                            className="flex-1 py-4 rounded-xl font-bold border border-white/15 bg-white/5 hover:bg-white/10 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                          >
                            <RefreshCw className={`w-5 h-5 ${storyboardLoading ? "animate-spin" : ""}`} />
                            Generate Again · {storyboardImageCost} credits
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCreateStoryboardVideo()}
                            disabled={storyboardLoading || videoLoading || !storyboardId}
                            className="flex-1 py-4 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-40"
                          >
                            {videoLoading && videoJobStoryboardId === storyboardId ? (
                              <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Working...
                              </>
                            ) : (
                              <>
                                <Play className="w-5 h-5" />
                                Create Video {storyboardVideoResolution} · {storyboardVideoCost} credits
                              </>
                            )}
                          </button>
                        </div>
                        {videoLoading && videoJobStoryboardId === storyboardId && (
                          <p className="text-sm text-emerald-400/95 flex items-center gap-2 justify-center text-center">
                            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                            Generating video with audio, this may take up to 2 minutes...
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Grid Settings — Seedance */}
                {engineTab === "seedance" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm font-bold text-slate-400">
                      <Layers className="w-4 h-4" />
                      Scenes
                    </label>
                    <select 
                      value={numScenes} 
                      onChange={(e) => setNumScenes(Number(e.target.value))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 appearance-none cursor-pointer"
                      disabled={loading}
                    >
                      <option value={1} className="bg-[#030712]">1 Scene</option>
                      <option value={2} className="bg-[#030712]">2 Scenes</option>
                      <option value={3} className="bg-[#030712]">3 Scenes</option>
                    </select>
                  </div>
                  
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm font-bold text-slate-400">
                      <Clock className="w-4 h-4" />
                      Duration/Scene
                    </label>
                    <select 
                      value={durationPerScene} 
                      onChange={(e) => setDurationPerScene(Number(e.target.value))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 appearance-none cursor-pointer"
                      disabled={loading}
                    >
                      <option value={5} className="bg-[#030712]">5 Seconds</option>
                      <option value={10} className="bg-[#030712]">10 Seconds</option>
                    </select>
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm font-bold text-slate-400">
                      <Monitor className="w-4 h-4" />
                      Resolution
                    </label>
                    <select 
                      value={resolution} 
                      onChange={(e) => setResolution(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 appearance-none cursor-pointer"
                      disabled={loading}
                    >
                      <option value="480p" className="bg-[#030712]">480p (Fast)</option>
                      <option value="720p" className="bg-[#030712]">720p (HD)</option>
                    </select>
                  </div>
                </div>
                )}

                {/* Veo controls */}
                {engineTab === "veo" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <label className="flex items-center gap-2 text-sm font-bold text-slate-400">Mode</label>
                      <select
                        value={veoMode}
                        onChange={(e) => setVeoMode(e.target.value as "single" | "perScene")}
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-violet-500/50 cursor-pointer"
                        disabled={loading}
                      >
                        <option value="single" className="bg-[#030712]">Single Video</option>
                        <option value="perScene" className="bg-[#030712]">Per Scene</option>
                      </select>
                    </div>
                    <div className="space-y-3">
                      <label className="flex items-center gap-2 text-sm font-bold text-slate-400">
                        {veoMode === "perScene" ? "Seconds per scene" : "Clip length"}
                      </label>
                      <select
                        value={veoDuration}
                        onChange={(e) => {
                          const v = Number(e.target.value) as 4 | 6 | 8;
                          setVeoDuration(v);
                        }}
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-violet-500/50 cursor-pointer"
                        disabled={loading || (veoResolution === "1080p")}
                      >
                        {veoResolution === "1080p" ? (
                          <option value={8} className="bg-[#030712]">8 seconds{veoMode === "perScene" ? " per scene" : ""} (required for 1080p)</option>
                        ) : (
                          <>
                            <option value={4} className="bg-[#030712]">4 seconds{veoMode === "perScene" ? " per scene" : ""}</option>
                            <option value={6} className="bg-[#030712]">6 seconds{veoMode === "perScene" ? " per scene" : ""}</option>
                            <option value={8} className="bg-[#030712]">8 seconds{veoMode === "perScene" ? " per scene" : ""}</option>
                          </>
                        )}
                      </select>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        {veoMode === "perScene" ? (
                          <>
                            Each generated scene runs for this long. Approximate final length:{" "}
                            <span className="text-slate-400 font-medium">
                              {veoDuration * veoNumScenes}s
                            </span>{" "}
                            ({veoNumScenes} scene{veoNumScenes !== 1 ? "s" : ""} × {veoDuration}s).
                          </>
                        ) : (
                          <>Single mode uses one Veo call; the whole clip is this long (not multiplied by prompt structure).</>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <label className="flex items-center gap-2 text-sm font-bold text-slate-400">Resolution</label>
                      <select
                        value={veoResolution}
                        onChange={(e) => {
                          const r = e.target.value as "720p" | "1080p";
                          setVeoResolution(r);
                          if (r === "1080p") setVeoDuration(8);
                        }}
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-violet-500/50 cursor-pointer"
                        disabled={loading}
                      >
                        <option value="720p" className="bg-[#030712]">720p</option>
                        <option value="1080p" className="bg-[#030712]">1080p (8s only)</option>
                      </select>
                    </div>
                    {veoMode === "single" ? (
                      <div className="space-y-3">
                        <label className="flex items-center gap-2 text-sm font-bold text-slate-400">Prompt structure</label>
                        <select
                          value={singlePromptScenes}
                          onChange={(e) => setSinglePromptScenes(Number(e.target.value) as 1 | 2)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-violet-500/50 cursor-pointer"
                          disabled={loading}
                        >
                          <option value={1} className="bg-[#030712]">1 continuous scene (one Veo call)</option>
                          <option value={2} className="bg-[#030712]">2 scenes + camera cut in one prompt (one Veo call)</option>
                        </select>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          This only changes how Gemini writes a single Veo prompt — still one generated video.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <label className="flex items-center gap-2 text-sm font-bold text-slate-400">
                          <Layers className="w-4 h-4" />
                          Scenes
                        </label>
                        <select
                          value={veoNumScenes}
                          onChange={(e) => setVeoNumScenes(Number(e.target.value))}
                          className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-violet-500/50 cursor-pointer"
                          disabled={loading}
                        >
                          <option value={1} className="bg-[#030712]">1 Scene</option>
                          <option value={2} className="bg-[#030712]">2 Scenes</option>
                          <option value={3} className="bg-[#030712]">3 Scenes</option>
                        </select>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Scene count multiplies with seconds-per-scene for total run time (e.g. 3 × 8s ≈ 24s).
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                )}
                {engineTab !== "storyboard" && (
                <div className="bg-white/[0.03] border border-white/10 rounded-[2.5rem] p-8 space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold flex items-center gap-2">
                      <Mic className="w-5 h-5 text-indigo-400" />
                      Narrator
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                        <Mic className="w-3.5 h-3.5" />
                        Voice
                      </label>
                      <select
                        value={voiceId}
                        onChange={(e) => setVoiceId(e.target.value)}
                        disabled={loading}
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 cursor-pointer"
                      >
                        {ENGLISH_VOICES.map((v) => (
                          <option key={v} value={v} className="bg-[#030712]">{humanizeVoice(v)}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                        <Smile className="w-3.5 h-3.5" />
                        Emotion
                      </label>
                      <select
                        value={emotion}
                        onChange={(e) => setEmotion(e.target.value)}
                        disabled={loading}
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 cursor-pointer"
                      >
                        {EMOTIONS.map((e) => (
                          <option key={e} value={e} className="bg-[#030712]">{humanizeEmotion(e)}</option>
                        ))}
                      </select>
                      {engineTab === "veo" && (
                        <p className="text-xs text-slate-500">
                          Veo sends a concrete voice mood to the server. &quot;Auto&quot; is mapped to <strong>neutral</strong> before the API call.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                )}

                {engineTab !== "storyboard" && (
                <>
                {/* Caption Styler Card */}
                <div className="bg-white/[0.03] border border-white/10 rounded-[2.5rem] p-8 space-y-8">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold flex items-center gap-2">
                      <Settings className="w-5 h-5 text-indigo-400" />
                      Caption Styler
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Font Family</label>
                        <select 
                          value={captionStyle.fontname} 
                          onChange={(e) => setCaptionStyle({...captionStyle, fontname: e.target.value})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 cursor-pointer"
                        >
                          <option value="Arial" className="bg-[#030712]">Arial</option>
                          <option value="Poppins" className="bg-[#030712]">Poppins</option>
                          <option value="Montserrat" className="bg-[#030712]">Montserrat</option>
                          <option value="Bangers" className="bg-[#030712]">Bangers</option>
                        </select>
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Font Size</label>
                        <input 
                          type="number" 
                          value={captionStyle.fontsize} 
                          onChange={(e) => setCaptionStyle({...captionStyle, fontsize: Number(e.target.value)})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Text Color</label>
                          <div className="flex items-center gap-2 p-1.5 bg-white/5 border border-white/10 rounded-xl">
                            <input 
                              type="color" 
                              value={captionStyle.highlightColor} 
                              onChange={(e) => setCaptionStyle({...captionStyle, highlightColor: e.target.value})}
                              className="w-10 h-10 bg-transparent border-none cursor-pointer rounded-lg overflow-hidden"
                            />
                            <span className="text-xs font-mono">{captionStyle.highlightColor}</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Outline</label>
                          <div className="flex items-center gap-2 p-1.5 bg-white/5 border border-white/10 rounded-xl">
                            <input 
                              type="color" 
                              value={captionStyle.outlineColor} 
                              onChange={(e) => setCaptionStyle({...captionStyle, outlineColor: e.target.value})}
                              className="w-10 h-10 bg-transparent border-none cursor-pointer rounded-lg overflow-hidden"
                            />
                            <span className="text-xs font-mono">{captionStyle.outlineColor}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Outline Thickness</label>
                        <input 
                          type="number" 
                          value={captionStyle.outlineThickness} 
                          onChange={(e) => setCaptionStyle({...captionStyle, outlineThickness: Number(e.target.value)})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                      </div>
                      
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Vertical Position</label>
                          <span className="text-xs font-bold text-indigo-400">{captionStyle.marginV}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" max="100" 
                          value={captionStyle.marginV} 
                          onChange={(e) => setCaptionStyle({...captionStyle, marginV: Number(e.target.value)})}
                          className="w-full accent-indigo-500"
                        />
                      </div>

                      <div className="flex items-center gap-3">
                        <input 
                          type="checkbox" 
                          id="highlightOnly"
                          checked={captionStyle.highlightOnly}
                          onChange={(e) => setCaptionStyle({...captionStyle, highlightOnly: e.target.checked})}
                          className="w-5 h-5 rounded border-white/10 bg-white/5 accent-indigo-600 cursor-pointer"
                        />
                        <label htmlFor="highlightOnly" className="text-sm font-bold text-slate-400 cursor-pointer select-none">
                          Highlight Only Mode
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
                </>
                )}

                {engineTab !== "storyboard" && (
                <button 
                  type="submit" 
                  disabled={loading}
                  className={`w-full py-5 rounded-2xl text-xl font-bold transition-all shadow-xl flex items-center justify-center gap-3 ${
                    loading 
                      ? "bg-white/10 text-slate-500 cursor-not-allowed" 
                      : engineTab === "veo"
                        ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:scale-[1.02] shadow-violet-500/20"
                        : "bg-gradient-to-r from-indigo-600 to-violet-600 hover:scale-[1.02] shadow-indigo-500/20"
                  }`}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-6 h-6 animate-spin" />
                      {engineTab === "veo"
                        ? "Veo + captions in progress — this may take several minutes..."
                        : "Generating scenes for visual consistency, this may take a few minutes..."}
                    </>
                  ) : (
                    <>
                      <Play className="w-6 h-6" />
                      {engineTab === "veo"
                        ? `Generate with Veo · ${veoCost} credits`
                        : `Generate Video · ${seedanceCost} credits`}
                    </>
                  )}
                </button>
                )}
              </form>

              {/* Advanced Testing Section — Seedance only */}
              {engineTab === "seedance" && (
              <div className="pt-8 border-t border-white/5">
                <div className="flex items-center gap-2 mb-4">
                  <RefreshCw className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Dev Pipeline Testing</h4>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col gap-6">
                  <div className="max-w-full">
                    <p className="text-sm text-slate-400 leading-relaxed mb-4">
                      Test the Whisper + Rendi stitching pipeline instantly using pre-generated assets from Replicate prediction IDs.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Audio Prediction ID</label>
                        <input 
                          type="text" 
                          value={testAudioPredictionId} 
                          onChange={(e) => setTestAudioPredictionId(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm font-mono"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Video Prediction ID</label>
                        <input 
                          type="text" 
                          value={testVideoPredictionId} 
                          onChange={(e) => setTestVideoPredictionId(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm font-mono"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button 
                      type="button"
                      onClick={async () => {
                        if (loading) return;
                        setLoading(true);
                        setError(null);
                        setVideoUrl(null);
                        setLogs(["Starting test pipeline (Fetching Replicate Outputs -> Whisper -> Rendi)..."]);
                        try {
                          const response = await fetch("/api/test-stitch", { 
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ 
                              captionStyle,
                              audioPredictionId: testAudioPredictionId,
                              videoPredictionId: testVideoPredictionId
                            })
                          });
                          const data = await response.json();
                          if (!response.ok) throw new Error(data.error || "Failed to test pipeline");
                          setVideoUrl(data.videoUrl);
                          setLogs((prev) => [...prev, "Test pipeline completed successfully!"]);
                        } catch (err: unknown) {
                          const message = err instanceof Error ? err.message : "An unexpected error occurred";
                          setError(message);
                          setLogs((prev) => [...prev, `Error: ${message}`]);
                        } finally {
                          setLoading(false);
                        }
                      }}
                      disabled={loading}
                      className="px-8 py-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl hover:bg-emerald-500/20 transition-all font-bold text-sm flex items-center justify-center gap-2 w-full md:w-auto"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      Run Stitching Test
                    </button>
                  </div>
                </div>
              </div>
              )}

            </div>
            <div className="lg:col-span-5 space-y-8">
              {engineTab !== "storyboard" && (
              <>
              {/* 9:16 Preview Box */}
              <div className="bg-black border border-white/10 rounded-[3rem] p-8 pb-12 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-black to-transparent z-10 pointer-events-none"></div>
                <div className="absolute inset-0 bg-indigo-600/5 opacity-0 group-hover:opacity-100 transition-opacity blur-[100px] pointer-events-none"></div>
                
                <div className="relative z-20 flex flex-col items-center">
                  <div className={`text-xs font-bold text-slate-500 uppercase tracking-[0.3em] ${engineTab === "seedance" ? "mb-8" : "mb-2"}`}>Live Caption Preview</div>
                  {engineTab === "veo" && (
                    <p className="text-[10px] text-amber-500/90 text-center max-w-[240px] mb-6 leading-relaxed">
                      WYSIWYG note: this preview uses 480×854 math. Veo outputs are 720p or 1080p — vertical caption position may differ slightly until a future preview update.
                    </p>
                  )}
                  <style dangerouslySetInnerHTML={{__html: `
                    @import url('https://fonts.googleapis.com/css2?family=Bangers&family=Montserrat:wght@700&family=Poppins:wght@800&display=swap');
                  `}} />
                  {(() => {
                    const FONT_METRIC_SCALES: Record<string, number> = {
                      "Arial": 0.87,
                      "Poppins": 0.86,
                      "Montserrat": 0.86,
                      "Bangers": 0.65
                    };
                    const DESCENDER_OFFSET_SCALES: Record<string, number> = {
                      "Arial": 0.08,
                      "Poppins": 0.08,
                      "Montserrat": 0.08,
                      "Bangers": 0.12
                    };
                    
                    const metricScale = FONT_METRIC_SCALES[captionStyle.fontname] || 0.85;
                    const offsetScale = DESCENDER_OFFSET_SCALES[captionStyle.fontname] || 0.08;

                    return (
                      <div className="w-[260px] aspect-[9/16] bg-slate-900 rounded-[2.5rem] border-[8px] border-white/10 overflow-hidden relative shadow-inner">
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60"></div>
                        
                        <div 
                          className="absolute w-full left-0 px-4 flex justify-center pointer-events-none transition-all duration-300"
                          style={{ 
                            bottom: `calc(${captionStyle.marginV * (854 - captionStyle.fontsize * 1.5) / 854}% + ${captionStyle.fontsize * (260 / 480) * offsetScale}px)`,
                          }}
                        >
                          <div 
                            className="relative font-extrabold text-center leading-none uppercase tracking-tight"
                            style={{ 
                              fontFamily: `"${captionStyle.fontname}", sans-serif`, 
                              fontSize: `${captionStyle.fontsize * (260 / 480) * metricScale}px`,
                            }}
                          >
                            {/* Outline effect via multiple layers */}
                            <div className="absolute inset-0 z-0" style={{
                              WebkitTextStroke: `${captionStyle.outlineThickness * (260 / 480) * 1.5}px ${captionStyle.outlineColor}`,
                              color: captionStyle.outlineColor,
                            }}>
                              BREATHTAKING
                            </div>
                            <div className="relative z-10" style={{ color: captionStyle.highlightColor }}>
                              BREATHTAKING
                            </div>
                          </div>
                        </div>
                        
                        {/* Mock UI Elements */}
                        <div className="absolute bottom-10 right-4 flex flex-col gap-4">
                          <div className="w-10 h-10 rounded-full bg-white/10 blur-[1px]"></div>
                          <div className="w-10 h-10 rounded-full bg-white/10 blur-[1px]"></div>
                          <div className="w-10 h-10 rounded-full bg-white/10 blur-[1px]"></div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
              </>
              )}

              {/* Status / Results Card */}
              <div className="space-y-6">
                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 flex items-start gap-4 animate-fade-in">
                    <AlertCircle className="w-6 h-6 text-red-500 shrink-0" />
                    <div>
                      <h4 className="font-bold text-red-500">Pipeline Error</h4>
                      <p className="text-sm text-red-500/80 mt-1">{error}</p>
                    </div>
                  </div>
                )}

                {videoUrl && (
                  <div className="bg-white/5 border border-white/10 rounded-[2.5rem] p-8 space-y-6 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold flex items-center gap-2">
                        <Play className="w-5 h-5 text-emerald-400" />
                        Final Result
                      </h3>
                      <a 
                        href={videoUrl} 
                        download 
                        className="p-3 bg-white/5 hover:bg-indigo-600 rounded-xl transition-all"
                        title="Download Video"
                      >
                        <Download className="w-5 h-5" />
                      </a>
                    </div>
                    <div className="flex justify-center">
                      <video 
                        src={videoUrl} 
                        controls 
                        className={
                          resultIsStoryboardFormat
                            ? "aspect-video w-full max-w-3xl max-h-[480px] object-contain bg-black rounded-3xl border border-white/10 shadow-2xl shadow-indigo-500/10"
                            : "aspect-[9/16] max-h-[500px] w-auto object-cover bg-black rounded-3xl border border-white/10 shadow-2xl shadow-indigo-500/10"
                        }
                      ></video>
                    </div>
                    <a 
                      href={videoUrl} 
                      target="_blank" 
                      rel="noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-4 bg-indigo-600 hover:bg-indigo-700 rounded-2xl font-bold transition-all"
                    >
                      <Download className="w-5 h-5" />
                      Save to Gallery
                    </a>
                    {/* Schedule hand-off is reel-only: storyboard clips are 16:9, but the
                        scheduler targets vertical YouTube Shorts. Deep-links the hosted
                        video URL + theme into the scheduler's existing asset intake. */}
                    {!resultIsStoryboardFormat && (
                      <Link
                        href={`/tools/scheduler?assetUrl=${encodeURIComponent(videoUrl)}${
                          theme.trim() ? `&title=${encodeURIComponent(theme.trim())}` : ""
                        }`}
                        className="flex items-center justify-center gap-2 w-full py-4 bg-emerald-600 hover:bg-emerald-500 rounded-2xl font-bold transition-all shadow-lg shadow-emerald-500/20"
                      >
                        <CalendarClock className="w-5 h-5" />
                        Schedule to YouTube
                      </Link>
                    )}
                  </div>
                )}

                {/* Log Output */}
                <div className="bg-black/40 border border-white/5 rounded-3xl p-6 font-mono text-[10px] md:text-xs">
                  <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/5">
                    <span className="text-slate-500 uppercase tracking-widest font-bold">Process Logs</span>
                    {loading || storyboardLoading || videoLoading ? (
                    <div className="flex items-center gap-2 text-indigo-400 animate-pulse">
                      <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></div>
                      Processing...
                    </div>
                    ) : null}
                  </div>
                  <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
                    {logs.length === 0 ? (
                      <div className="text-slate-700 italic">No process running.</div>
                    ) : (
                      logs.map((log, i) => (
                        <div key={i} className="flex gap-3">
                          <span className="text-slate-600">[{i+1}]</span>
                          <span className={log.startsWith("Error") ? "text-red-400" : "text-slate-400"}>{log}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {engineTab === "storyboard" && (
            <>
            <div className="mt-16 space-y-16 border-t border-white/10 pt-16 pb-8">
              <div>
                <div className="flex flex-wrap gap-2 mb-4">
                  <button
                    type="button"
                    onClick={() => setStoryboardStyleFilter("all")}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                      storyboardStyleFilter === "all"
                        ? "bg-emerald-600 text-white border border-emerald-500"
                        : "bg-transparent text-slate-400 border border-white/15 hover:border-white/30"
                    }`}
                  >
                    All Styles
                  </button>
                  {STORYBOARD_STYLE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setStoryboardStyleFilter(opt.value)}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                        storyboardStyleFilter === opt.value
                          ? "bg-emerald-600 text-white border border-emerald-500"
                          : "bg-transparent text-slate-400 border border-white/15 hover:border-white/30"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <h2 className="text-2xl font-black tracking-tight mb-2">Storyboard Gallery</h2>
                <p className="text-sm text-slate-500 mb-6">
                  Your saved storyboards (newest first). Sign in to see only your work.
                </p>
                {storyboards.length === 0 ? (
                  <p className="text-slate-600 text-sm">No storyboards yet.</p>
                ) : filteredStoryboardGalleryRows.length === 0 ? (
                  <p className="text-slate-600 text-sm">No storyboards match this filter.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredStoryboardGalleryRows.map((row) => {
                      const cardRes = galleryVideoResolution[row.id] ?? "480p";
                      const cardCost = videoCredits(seedancePricingKey(cardRes), 15);
                      const cardProcessing =
                        videoLoading && videoJobStoryboardId === row.id;
                      return (
                      <div
                        key={row.id}
                        className="bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden flex flex-col"
                      >
                        <div className="aspect-[3/2] bg-black/50 border-b border-white/5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={row.storyboard_url}
                            alt=""
                            className="w-full h-full object-contain cursor-pointer"
                            onClick={() => setLightboxUrl(row.storyboard_url)}
                          />
                        </div>
                        <div className="p-4 flex flex-col gap-2 flex-1">
                          <p className="text-sm text-slate-200 line-clamp-2 font-medium">{row.theme}</p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-slate-400 font-medium">
                              {storyboardStyleDisplayName(row.storyboard_style)}
                            </span>
                            <span className="text-slate-500">
                              {new Date(row.created_at).toLocaleString()}
                            </span>
                          </div>
                          <div className="mt-auto pt-2">
                            {!row.video_url ? (
                              <div className="flex flex-col gap-2">
                                {/* Per-card resolution selector — drives the Seedance
                                    pricing tier + provider resolution for this board. */}
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                                    Video resolution
                                  </span>
                                  <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5">
                                    {(["480p", "720p"] as const).map((res) => {
                                      const resCost = videoCredits(seedancePricingKey(res), 15);
                                      return (
                                        <button
                                          key={res}
                                          type="button"
                                          onClick={() =>
                                            setGalleryVideoResolution((prev) => ({
                                              ...prev,
                                              [row.id]: res,
                                            }))
                                          }
                                          disabled={videoLoading}
                                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all disabled:opacity-40 ${
                                            cardRes === res
                                              ? "bg-emerald-600 text-white"
                                              : "text-slate-400 hover:text-white"
                                          }`}
                                        >
                                          {res} · {resCost} cr
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleGalleryCreateVideo(row.id)}
                                  disabled={videoLoading}
                                  className="w-full py-2.5 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 flex items-center justify-center gap-2"
                                >
                                  {cardProcessing ? (
                                    <>
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                      Generating…
                                    </>
                                  ) : (
                                    <>
                                      <Play className="w-4 h-4" />
                                      Create Video {cardRes} · {cardCost} credits
                                    </>
                                  )}
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => row.video_url && playStoryboardVideo(row.video_url)}
                                className="w-full py-2.5 rounded-xl font-bold text-sm border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                              >
                                View Video
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
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
                  alt="Storyboard full size"
                  className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
            </>
          )}

          <CreationsHistory
            title="Your video generations"
            description="Reels (Seedance & Veo) and storyboard videos — saved to your account."
            tools={["reels_seedance", "reels_veo", "storyboard_video"]}
            mediaType="video"
            refreshKey={historyRefreshKey}
            selectedUrl={videoUrl}
            onSelect={(item) => {
              setVideoUrl(item.mediaUrl);
              setResultIsStoryboardFormat(item.tool === "storyboard_video");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </div>
      </main>
    </div>
  );
}

