"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReactFlow, useStore, type Node, type NodeProps } from "@xyflow/react";
import { AlertCircle, Clock, Cpu, Crop, Video, Volume2, VolumeX } from "lucide-react";
import {
  ChipDropdown,
  CreditActionButton,
  GENERATE_BTN_CLASS,
  GenerationCancelButton,
  STUDIO_CHIP_ROW_CLASS,
  uploadRefFile,
} from "@/components/studio";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { usePricing } from "@/app/(app)/pricing-context";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useIdempotentSubmit } from "@/lib/use-idempotent-submit";
import { useGenerationStatusPoll } from "@/lib/use-generation-status-poll";
import { pickGenerateStoragePath, useSignedMediaUrl } from "@/lib/use-signed-media-url";
import {
  TEXT_TO_VIDEO_MODELS,
  getAllowedDurations,
  getVideoModel,
  type VideoAspectRatio,
  type VideoModelId,
  type VideoResolution,
} from "@/lib/video-models";
import {
  CANVAS_KIND_LABELS,
  findUpstreamImages,
  findUpstreamPrompts,
  findUpstreamPromptTexts,
  mentionedCanvasImages,
  mergeCanvasImages,
  resolveCanvasMentionPrompt,
  usableCanvasRefImages,
  MAX_CANVAS_REF_IMAGES,
  type CanvasGraphEdge,
  type CanvasGraphNode,
} from "@/lib/canvas-graph";
import {
  describeCanvasIdempotencyError,
  pickGenerateCreationId,
  resolveCanvasRefFrames,
} from "../canvas-api";
import CanvasNodeFrame from "./CanvasNodeFrame";
import CanvasOmniForm from "./CanvasOmniForm";
import CanvasSourceRefs from "./CanvasSourceRefs";
import CanvasMentionField from "./CanvasMentionField";
import CanvasMediaBox from "./CanvasMediaBox";
import CanvasAssetActions from "./CanvasAssetActions";
import { useCanvasPreview } from "../CanvasPreview";
import { useCanvasLibrary } from "../CanvasLibraryPicker";
import type { VideoNodeData } from "../node-data";

export type VideoFlowNode = Node<VideoNodeData, "video">;

export default function VideoNode({
  id,
  data,
  selected,
}: NodeProps<VideoFlowNode>) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { updateNodeData, deleteElements } = useReactFlow();
  const openPreview = useCanvasPreview();
  const { openLibrary } = useCanvasLibrary();
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const nodes = useStore((s) => s.nodes) as unknown as CanvasGraphNode[];
  const edges = useStore((s) => s.edges) as unknown as CanvasGraphEdge[];
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling, activeKey } = useIdempotentSubmit();
  const { cancelAllowed } = useGenerationStatusPoll(activeKey);
  const { balance, refetch: refetchCredits } = useCreditBalance();
  const { videoCredits } = usePricing();

  const signedUrl = useSignedMediaUrl(data.resultStoragePath, data.resultUrl);
  const previewUrl = localPreview ?? signedUrl ?? data.resultUrl;

  const connectedPromptSources = findUpstreamPrompts(nodes, edges, id);
  const connectedPrompts = findUpstreamPromptTexts(nodes, edges, id);
  const connectedImages = findUpstreamImages(nodes, edges, id);
  const refImages = usableCanvasRefImages(
    mergeCanvasImages(connectedImages, mentionedCanvasImages(data.prompt, nodes))
  ).slice(0, MAX_CANVAS_REF_IMAGES);
  const connectedPrompt = connectedPrompts.join("\n\n") || null;
  const prompt =
    resolveCanvasMentionPrompt(data.prompt.trim(), nodes) || connectedPrompt || "";
  const model = getVideoModel(data.modelId);
  const allowedDurations = getAllowedDurations(model, data.resolution);

  useEffect(() => {
    if (!allowedDurations.includes(data.duration) && allowedDurations[0]) {
      updateNodeData(id, { duration: allowedDurations[0] });
    }
  }, [allowedDurations, data.duration, id, updateNodeData]);

  const generateAudio = model.supportsAudio ? data.generateAudio : model.defaultGenerateAudio;
  const videoPricingKey = model.pricingKey({
    resolution: data.resolution,
    generateAudio,
  });
  const cost = videoCredits(videoPricingKey, data.duration);
  const canGenerate = prompt.length > 0;

  const patch = (next: Partial<VideoNodeData>) => updateNodeData(id, next);

  const handleUpload = async (file: File) => {
    if (localPreview) URL.revokeObjectURL(localPreview);
    const preview = URL.createObjectURL(file);
    setLocalPreview(preview);
    patch({ uploading: true, error: null });
    try {
      const uploaded = await uploadRefFile(file);
      patch({
        resultUrl: uploaded.url,
        resultStoragePath: uploaded.path,
        creationId: null,
        imported: true,
        uploading: false,
        error: null,
      });
      URL.revokeObjectURL(preview);
      setLocalPreview(null);
    } catch (err) {
      patch({
        uploading: false,
        error: err instanceof Error ? err.message : "Upload failed.",
      });
    }
  };

  const modelOptions = useMemo(
    () => TEXT_TO_VIDEO_MODELS.map((m) => ({ id: m.id, label: m.modelLabel })),
    []
  );

  const handleGenerate = async () => {
    if (!canGenerate) return;
    if (status !== "authenticated") {
      openSignInModal();
      return;
    }

    let firstFrame: { url: string; path: string } | null = null;
    let referenceImages: { url: string; path: string }[] = [];
    if (refImages.length > 0) {
      try {
        const frames = await resolveCanvasRefFrames(refImages);
        if (frames.some((frame) => frame.url.startsWith("blob:"))) {
          patch({
            error: "A connected image isn't ready to send. Wait for the upload to finish, then try again.",
          });
          return;
        }
        const refCap = model.references.referenceImages;
        if (refCap > 0) {
          if (frames.length > refCap) {
            patch({
              error: `${model.modelLabel} can use up to ${refCap} reference images.`,
            });
            return;
          }
          referenceImages = frames;
        } else if (model.references.firstFrame) {
          if (frames.length > 1) {
            patch({
              error: `${model.modelLabel} can only use one start-frame image. Pick a model that accepts reference images to send every still.`,
            });
            return;
          }
          firstFrame = frames[0] ?? null;
        } else {
          patch({
            error: `${model.modelLabel} can't use reference images. Pick a reference-capable model.`,
          });
          return;
        }
      } catch (err) {
        patch({
          error: err instanceof Error ? err.message : "Couldn't use the connected image.",
        });
        return;
      }
    }

    const body = {
      modelId: data.modelId,
      prompt,
      duration: data.duration,
      resolution: data.resolution,
      aspectRatio: data.aspectRatio,
      generateAudio,
      references: { firstFrame, referenceImages },
    };
    const attempt = beginSubmit(JSON.stringify(body));
    if (!attempt) return;

    patch({ loading: true, error: null });
    try {
      const response = await fetch("/api/generate-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result.code === "GENERATION_CANCELLED") {
          attempt.settle(false);
          refetchCredits();
          patch({ loading: false });
          return;
        }
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${result.requiredCredits ?? cost}, current: ${result.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeCanvasIdempotencyError(response.status, result);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(result.error || "Generation failed");
      }
      attempt.settle(true);
      refetchCredits();
      const storagePath = pickGenerateStoragePath(result);
      patch({
        loading: false,
        error: null,
        imported: false,
        resultUrl: result.videoUrl ?? null,
        resultStoragePath: storagePath,
        creationId: pickGenerateCreationId(result),
      });
    } catch (err) {
      attempt.settle(false);
      patch({
        loading: false,
        error: err instanceof Error ? err.message : "Generation failed",
      });
    }
  };

  const selectModel = (nextId: string) => {
    const next = getVideoModel(nextId);
    const nextDurations = getAllowedDurations(next, next.defaultResolution);
    patch({
      modelId: next.id as VideoModelId,
      resolution: next.defaultResolution,
      aspectRatio: next.defaultAspectRatio,
      duration: nextDurations.includes(data.duration) ? data.duration : next.defaultDuration,
      generateAudio: next.defaultGenerateAudio,
    });
  };

  return (
    <CanvasNodeFrame
      kind="video"
      title={data.label.trim() || CANVAS_KIND_LABELS.video}
      selected={selected}
      onRemove={() => void deleteElements({ nodes: [{ id }] })}
      asset={
        <CanvasMediaBox
          kind="video"
          url={previewUrl}
          onOpen={
            previewUrl && !data.loading
              ? () => openPreview({ kind: "video", url: previewUrl })
              : undefined
          }
          empty={
            <div className="flex h-full flex-col items-center justify-center gap-2 text-text-secondary">
              <Video className="h-8 w-8 text-icon-low-emphasis" />
              <p className="text-xs">Output will appear here…</p>
            </div>
          }
          overlay={
            <>
              {(data.loading || data.uploading) && (
                <div className="absolute inset-0 animate-pulse bg-white/10" />
              )}
              {!previewUrl && (
                <CanvasAssetActions
                  onLibrary={() =>
                    openLibrary({
                      mediaType: "video",
                      onPick: (item) => {
                        if (localPreview) URL.revokeObjectURL(localPreview);
                        setLocalPreview(null);
                        patch({
                          resultUrl: item.mediaUrl,
                          resultStoragePath: item.storagePath || null,
                          creationId: item.id,
                          imported: true,
                          error: null,
                          uploading: false,
                        });
                      },
                    })
                  }
                  onUpload={() => fileRef.current?.click()}
                />
              )}
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleUpload(file);
                }}
              />
            </>
          }
        />
      }
      form={
        data.imported ? undefined : (
        <CanvasOmniForm>
          <CanvasSourceRefs
            targetId={id}
            images={refImages}
            prompts={connectedPromptSources}
          />
          <CanvasMentionField
            value={data.prompt}
            onChange={(next) => patch({ prompt: next })}
            nodes={nodes.map((node) => ({
              id: node.id,
              label: node.data.label ?? "",
              kind: node.data.kind,
            }))}
            selfId={id}
            placeholder="Describe the video…  Type @ to mention a node"
            disabled={data.loading}
          />
          <div className={`${STUDIO_CHIP_ROW_CLASS} mb-2`}>
            <ChipDropdown
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={model.modelLabel}
              options={modelOptions}
              activeId={data.modelId}
              square
              onSelect={selectModel}
            />
            <ChipDropdown
              icon={<Clock className="h-3.5 w-3.5" />}
              value={`${data.duration}s`}
              options={allowedDurations.map((d) => ({ id: String(d), label: `${d}s` }))}
              activeId={String(data.duration)}
              square
              onSelect={(next) => patch({ duration: Number(next) })}
            />
            <ChipDropdown
              icon={<Crop className="h-3.5 w-3.5" />}
              value={data.aspectRatio}
              options={model.aspectRatios.map((r) => ({ id: r, label: r }))}
              activeId={data.aspectRatio}
              square
              onSelect={(next) => patch({ aspectRatio: next as VideoAspectRatio })}
            />
            <ChipDropdown
              icon={<Video className="h-3.5 w-3.5" />}
              value={data.resolution}
              options={model.resolutions.map((r) => ({ id: r, label: r }))}
              activeId={data.resolution}
              square
              onSelect={(next) => patch({ resolution: next as VideoResolution })}
            />
            {model.supportsAudio && (
              <button
                type="button"
                onClick={() => patch({ generateAudio: !data.generateAudio })}
                className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium transition-colors ${
                  data.generateAudio
                    ? "bg-white/5 text-text-primary hover:bg-white/10"
                    : "bg-white/5 text-text-disabled hover:bg-white/10 hover:text-text-secondary"
                }`}
              >
                {data.generateAudio ? (
                  <Volume2 className="h-3.5 w-3.5 text-text-secondary" />
                ) : (
                  <VolumeX className="h-3.5 w-3.5 text-text-disabled" />
                )}
                Audio
              </button>
            )}
          </div>
          {data.error && (
            <p className="mb-2 flex items-start gap-1.5 text-[11px] text-error">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {data.error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <CreditActionButton
              type="button"
              balance={balance}
              cost={cost}
              ready={canGenerate}
              loading={data.loading}
              label="Generate"
              onClick={() => void handleGenerate()}
              className={`${GENERATE_BTN_CLASS} flex-1 !h-9 !px-3 !text-xs`}
            />
            <GenerationCancelButton
              visible={data.loading}
              cancelling={cancelling}
              cancelAllowed={cancelAllowed}
              onCancel={() => void cancelSubmit()}
            />
          </div>
        </CanvasOmniForm>
        )
      }
    />
  );
}
