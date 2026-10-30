"use client";

import { cancelWithNotice } from "@/lib/generation-cancel-client-pure";
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
import { videoPromptLimitError, videoPromptMaxChars } from "@/lib/skills";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useIdempotentSubmit } from "@/lib/use-idempotent-submit";
import { useGenerationStatusPoll } from "@/lib/use-generation-status-poll";
import {
  CANVAS_VIDEO_NOT_SAVED_MESSAGE,
  hasSavedVideo,
  pollCanvasVideoResult,
} from "@/lib/canvas-video-completion";
import { pickGenerateStoragePath, useSignedMediaUrlState } from "@/lib/use-signed-media-url";
import {
  getAllowedDurations,
  formatVideoModelCreditHint,
  getVideoModel,
  type VideoAspectRatio,
  type VideoModelId,
  type VideoResolution,
} from "@/lib/video-models";
import {
  canvasVideoComposerKey,
  canvasVideoModelFitsInput,
  canvasVideoModelOptions,
  snapCanvasVideoModel,
} from "@/lib/canvas-model-options";
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
  isIdempotencyConflict,
  pickGenerateCreationId,
  resolveCanvasRefFrames,
} from "../canvas-api";
import CanvasNodeFrame from "./CanvasNodeFrame";
import CanvasOmniForm from "./CanvasOmniForm";
import CanvasSourceRefs from "./CanvasSourceRefs";
import CanvasMentionField from "./CanvasMentionField";
import CanvasMediaBox from "./CanvasMediaBox";
import { useCanvasAssetOrigin } from "./CanvasAssetOrigin";
import CanvasAssetActions from "./CanvasAssetActions";
import { useCanvasPreview } from "../CanvasPreview";
import { useCanvasLibrary } from "../CanvasLibraryPicker";
import type { VideoNodeData } from "../node-data";
import { useCanvasVideoFeatures } from "../use-canvas-features";
import { canvasNodeFingerprint, canvasRunDeps } from "@/lib/canvas-run-plan";
import {
  canvasRunFailure,
  useCanvasNodeRunner,
  useFreshCanvasGraph,
  type CanvasRunOutcome,
} from "../canvas-run";

export type VideoFlowNode = Node<VideoNodeData, "video">;

/** Why `model` can't take `count` connected stills, or null when it can. */
function videoReferenceError(model: ReturnType<typeof getVideoModel>, count: number): string | null {
  if (count === 0) return null;
  const refCap = model.references.referenceImages;
  if (refCap > 0) {
    return count > refCap ? `${model.modelLabel} can use up to ${refCap} reference images.` : null;
  }
  if (model.references.firstFrame) {
    return count > 1
      ? `${model.modelLabel} can only use one start-frame image. Pick a model that accepts reference images to send every still.`
      : null;
  }
  return `${model.modelLabel} can't use reference images. Pick a reference-capable model.`;
}

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
  const [modelNote, setModelNote] = useState<string | null>(null);
  const features = useCanvasVideoFeatures();
  const nodes = useStore((s) => s.nodes) as unknown as CanvasGraphNode[];
  const edges = useStore((s) => s.edges) as unknown as CanvasGraphEdge[];
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling, activeKey } =
    useIdempotentSubmit(`canvas:video:${id}`);
  const { cancelAllowed } = useGenerationStatusPoll(activeKey);
  const { balance, refetch: refetchCredits } = useCreditBalance();
  const { videoCredits } = usePricing();
  const freshGraph = useFreshCanvasGraph(id, data);

  const { url: signedUrl, failed: mediaFailed } = useSignedMediaUrlState(
    data.resultStoragePath,
    data.resultUrl
  );
  const previewUrl = localPreview ?? signedUrl ?? data.resultUrl;
  const origin = useCanvasAssetOrigin(data.resultStoragePath, data.creationId, "video");

  // What Generate sends. Render, Generate and a chain run all resolve inputs here.
  const resolveInputs = (
    graphNodes: CanvasGraphNode[],
    graphEdges: CanvasGraphEdge[],
    nodeData: VideoNodeData
  ) => {
    const connectedPrompt =
      findUpstreamPromptTexts(graphNodes, graphEdges, id).join("\n\n") || null;
    const refImages = usableCanvasRefImages(
      mergeCanvasImages(
        findUpstreamImages(graphNodes, graphEdges, id),
        mentionedCanvasImages(nodeData.prompt, graphNodes)
      )
    ).slice(0, MAX_CANVAS_REF_IMAGES);
    const prompt =
      resolveCanvasMentionPrompt(nodeData.prompt.trim(), graphNodes) || connectedPrompt || "";
    const model = getVideoModel(nodeData.modelId);
    const generateAudio = model.supportsAudio ? nodeData.generateAudio : model.defaultGenerateAudio;
    const cost = videoCredits(
      model.pricingKey({ resolution: nodeData.resolution, generateAudio }),
      nodeData.duration
    );
    const limitError = videoPromptLimitError(prompt, videoPromptMaxChars(model));
    const modelValid = canvasVideoModelOptions(refImages.length > 0, features.data).some(
      (m) => m.id === nodeData.modelId
    );
    const canGenerate = prompt.length > 0 && !limitError && modelValid;
    return { refImages, prompt, model, generateAudio, cost, limitError, canGenerate };
  };

  const connectedPromptSources = findUpstreamPrompts(nodes, edges, id);
  const { refImages, model, cost, limitError, canGenerate } = resolveInputs(nodes, edges, data);
  const allowedDurations = getAllowedDurations(model, data.resolution);

  useEffect(() => {
    if (!allowedDurations.includes(data.duration) && allowedDurations[0]) {
      updateNodeData(id, { duration: allowedDurations[0] });
    }
  }, [allowedDurations, data.duration, id, updateNodeData]);

  const hasRef = refImages.length > 0;
  const modelOptions = useMemo(
    () => canvasVideoModelOptions(hasRef, features.data),
    [hasRef, features.data]
  );
  // Unknown enablement is "not ready", never "everything is enabled".
  const modelsReady = features.data !== null;
  const modelValid = modelOptions.some((m) => m.id === data.modelId);

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

  const modelChipOptions = useMemo(
    () =>
      modelOptions.map((m) => ({
        id: m.id,
        label: m.modelLabel,
        hint: formatVideoModelCreditHint(m, videoCredits, data.duration),
      })),
    [modelOptions, videoCredits, data.duration]
  );

  const handleGenerate = async (options: { chain?: boolean } = {}): Promise<CanvasRunOutcome> => {
    const graph = freshGraph();
    const input = resolveInputs(graph.nodes, graph.edges, graph.data);
    const fingerprint = canvasNodeFingerprint(id, graph.nodes, graph.edges);
    if (!input.canGenerate) {
      if (options.chain) {
        patch(canvasRunFailure(input.limitError ?? "This node isn't ready to run.", fingerprint));
      }
      return "failed";
    }
    if (status !== "authenticated") {
      openSignInModal();
      return "auth";
    }

    const { model, prompt, generateAudio } = input;
    const nodeData = graph.data;
    let firstFrame: { url: string; path: string } | null = null;
    let referenceImages: { url: string; path: string }[] = [];
    if (input.refImages.length > 0) {
      try {
        const frames = await resolveCanvasRefFrames(input.refImages);
        const refError = videoReferenceError(model, frames.length);
        if (refError) {
          patch(canvasRunFailure(refError, fingerprint));
          return "failed";
        }
        if (model.references.referenceImages > 0) referenceImages = frames;
        else firstFrame = frames[0] ?? null;
      } catch (err) {
        patch(
          canvasRunFailure(
            err instanceof Error ? err.message : "Couldn't use the connected image.",
            fingerprint
          )
        );
        return "failed";
      }
    }

    const body = {
      composerKey: canvasVideoComposerKey(nodeData.modelId),
      modelId: nodeData.modelId,
      prompt,
      duration: nodeData.duration,
      resolution: nodeData.resolution,
      aspectRatio: nodeData.aspectRatio,
      generateAudio,
      references: { firstFrame, referenceImages },
    };
    // Signed URLs are minted per click; sign only the stable storage paths.
    const attempt = beginSubmit(
      JSON.stringify({
        ...body,
        references: {
          firstFrame: firstFrame && { path: firstFrame.path },
          referenceImages: referenceImages.map((frame) => ({ path: frame.path })),
        },
      }),
    );
    if (!attempt) return "busy";

    let rotateKey = false;
    let outcome: CanvasRunOutcome = "failed";
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
          return "cancelled";
        }
        if (response.status === 402) {
          outcome = "insufficient";
          throw new Error(
            `Insufficient credits. Required: ${result.requiredCredits ?? input.cost}, current: ${result.currentBalance ?? 0}.`
          );
        }
        if (response.status === 409 && result.code === "GENERATION_IN_PROGRESS") outcome = "busy";
        rotateKey = isIdempotencyConflict(response.status, result);
        const idemMsg = describeCanvasIdempotencyError(response.status, result);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(result.error || "Generation failed");
      }
      // HTTP 202 / "processing" is non-terminal: keep loading + the idempotency lock until polling is terminal.
      const saved =
        response.status === 202 || result.status === "processing"
          ? await pollCanvasVideoResult(attempt.key)
          : result;
      if (!hasSavedVideo(saved)) throw new Error(CANVAS_VIDEO_NOT_SAVED_MESSAGE);
      attempt.settle(true);
      refetchCredits();
      patch({
        loading: false,
        error: null,
        imported: false,
        resultUrl: saved.videoUrl ?? null,
        resultStoragePath: pickGenerateStoragePath(saved),
        creationId: pickGenerateCreationId(saved),
        runFingerprint: fingerprint,
        lastRunError: undefined,
      });
      return "done";
    } catch (err) {
      attempt.settle(false, { rotate: rotateKey });
      if ((err as { code?: string })?.code === "GENERATION_CANCELLED") {
        refetchCredits();
        patch({ loading: false });
        return "cancelled";
      }
      const message = err instanceof Error ? err.message : "Generation failed";
      // Credits and a run already in progress are not a failure of this node's inputs.
      patch(
        outcome === "failed"
          ? { loading: false, ...canvasRunFailure(message, fingerprint) }
          : { loading: false, error: message }
      );
      return outcome;
    }
  };

  useCanvasNodeRunner(id, {
    run: handleGenerate,
    cancel: cancelSubmit,
    cost: () => {
      const graph = freshGraph();
      return resolveInputs(graph.nodes, graph.edges, graph.data).cost;
    },
    check: (pending) => {
      const graph = freshGraph();
      const input = resolveInputs(graph.nodes, graph.edges, graph.data);
      const deps = canvasRunDeps(id, graph.nodes, graph.edges)
        .map((depId) => graph.nodes.find((node) => node.id === depId))
        .filter((node) => node !== undefined);
      const textComing = deps.some((node) => node.data.kind === "prompt" && pending.has(node.id));
      const refIds = new Set(input.refImages.map((image) => image.id));
      for (const node of deps) {
        if (node.data.kind === "image" && pending.has(node.id)) refIds.add(node.id);
      }
      const refCount = Math.min(refIds.size, MAX_CANVAS_REF_IMAGES);
      if (deps.some((node) => node.data.uploading)) return "A connected image is still uploading.";
      if (!input.prompt && !textComing) return "Add a prompt or connect a Text node.";
      if (input.limitError && !textComing) return input.limitError;
      if (features.data === null) return "Models are still loading. Try again in a moment.";
      const fits = canvasVideoModelOptions(refCount > 0, features.data).some(
        (m) => m.id === graph.data.modelId
      );
      if (!fits) {
        return refCount > 0
          ? `${input.model.modelLabel} can't use reference images. Pick a reference-capable model.`
          : `${input.model.modelLabel} needs a reference image. Connect an Image node or pick another model.`;
      }
      return videoReferenceError(input.model, refCount);
    },
  });

  const selectModel = (nextId: string, note: string | null = null) => {
    setModelNote(note);
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

  // Snap to a valid, admin-enabled model once enablement is known (never before).
  const snapId = modelsReady && !modelValid ? snapCanvasVideoModel(data.modelId, modelOptions, features.data) : null;
  useEffect(() => {
    if (!snapId || snapId === data.modelId) return;
    const next = getVideoModel(snapId);
    const reason = canvasVideoModelFitsInput(getVideoModel(data.modelId), hasRef)
      ? "isn't available right now"
      : hasRef
        ? "can't use reference images"
        : "can't be used without a reference image";
    selectModel(snapId, `${getVideoModel(data.modelId).modelLabel} ${reason}, so the model was switched to ${next.modelLabel}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapId, data.modelId, hasRef]);

  return (
    <CanvasNodeFrame
      kind="video"
      title={data.label.trim() || CANVAS_KIND_LABELS.video}
      selected={selected}
      sourceId={previewUrl ? id : undefined}
      onRemove={() => void deleteElements({ nodes: [{ id }] })}
      asset={
        <CanvasMediaBox
          kind="video"
          url={previewUrl}
          onOpen={
            previewUrl && !data.loading
              ? () =>
                  openPreview({
                    kind: "video",
                    url: previewUrl,
                    createdBy: origin.createdBy,
                    onShowInLibrary: origin.onShowInLibrary,
                  })
              : undefined
          }
          empty={
            <div className="flex h-full flex-col items-center justify-center gap-2 text-text-secondary">
              <Video className="h-8 w-8 text-icon-low-emphasis" />
              <p className="px-3 text-center text-xs">
                {mediaFailed && data.resultStoragePath
                  ? "Couldn't open this file."
                  : "Output will appear here…"}
              </p>
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
          {limitError && (
            <p role="alert" className="mb-2 text-[11px] text-error">
              {limitError}
            </p>
          )}
          <div className={`${STUDIO_CHIP_ROW_CLASS} mb-2`}>
            {modelsReady ? (
              modelOptions.length > 0 && (
                <ChipDropdown
                  icon={<Cpu className="h-3.5 w-3.5" />}
                  value={model.modelLabel}
                  options={modelChipOptions}
                  activeId={data.modelId}
                  square
                  onSelect={(next) => selectModel(next)}
                />
              )
            ) : (
              <div className="h-8 w-28 animate-pulse rounded-lg bg-white/5" aria-hidden />
            )}
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
          {modelNote && modelValid && (
            <p role="status" className="mb-2 text-[11px] text-text-secondary">
              {modelNote}
            </p>
          )}
          {features.status === "error" && !modelsReady && (
            <p role="alert" className="mb-2 text-[11px] text-error">
              Couldn&apos;t load available models. Try again in a moment.
            </p>
          )}
          {modelsReady && modelOptions.length === 0 && (
            <p role="alert" className="mb-2 text-[11px] text-error">
              No models are available for this tool right now.
            </p>
          )}
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
              onCancel={() => void cancelWithNotice(cancelSubmit, (notice) => patch({ error: notice }))}
            />
          </div>
        </CanvasOmniForm>
        )
      }
    />
  );
}
