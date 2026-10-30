"use client";

import { cancelWithNotice } from "@/lib/generation-cancel-client-pure";
import { useEffect, useRef, useState } from "react";
import { useReactFlow, useStore, type Node, type NodeProps } from "@xyflow/react";
import { AlertCircle, Clock, Cpu, Crop, ImageIcon, Sparkles } from "lucide-react";
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
import { pickGenerateStoragePath, useSignedMediaUrlState } from "@/lib/use-signed-media-url";
import {
  DEFAULT_MODEL_POSE,
  DEFAULT_PHOTO_STYLE,
  DEFAULT_PRODUCT_PHOTO_QUALITY,
  photoAspectRatioDisplayForTier,
  getProductPhotoTier,
  photoAspectRatioOptionsForTier,
  photoTierPriceHint,
  photoTierPricingKey,
  type PhotoAspectRatio,
  type ProductPhotoModelTier,
  type ProductPhotoQuality,
  type ProductPhotoResolution,
} from "@/lib/product-photo";
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
  blobFileFromUrl,
  describeCanvasIdempotencyError,
  isIdempotencyConflict,
  pickGenerateCreationId,
  resolveCanvasRefFrames,
} from "../canvas-api";
import { canvasImageAttemptSignature } from "@/lib/canvas-image-signature";
import { canvasImageTierOptions, snapCanvasImageTier } from "@/lib/canvas-model-options";
import CanvasNodeFrame from "./CanvasNodeFrame";
import CanvasOmniForm from "./CanvasOmniForm";
import CanvasSourceRefs from "./CanvasSourceRefs";
import CanvasMentionField from "./CanvasMentionField";
import CanvasMediaBox, { isPngAsset } from "./CanvasMediaBox";
import { useCanvasAssetOrigin } from "./CanvasAssetOrigin";
import CanvasAssetActions from "./CanvasAssetActions";
import { useCanvasPreview } from "../CanvasPreview";
import { useCanvasLibrary } from "../CanvasLibraryPicker";
import type { ImageNodeData } from "../node-data";
import { useCanvasImageFeatures } from "../use-canvas-features";
import { describeGenerateHttpError } from "@/lib/canvas-generation-error";
import { photoPromptLimitError } from "@/lib/skills";
import { canvasNodeFingerprint, canvasRunDeps } from "@/lib/canvas-run-plan";
import {
  canvasRunFailure,
  useCanvasNodeRunner,
  useFreshCanvasGraph,
  type CanvasRunOutcome,
} from "../canvas-run";

export type ImageFlowNode = Node<ImageNodeData, "image">;

export default function ImageNode({
  id,
  data,
  selected,
}: NodeProps<ImageFlowNode>) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { updateNodeData, deleteElements } = useReactFlow();
  const openPreview = useCanvasPreview();
  const { openLibrary } = useCanvasLibrary();
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [localPng, setLocalPng] = useState(false);
  const nodes = useStore((s) => s.nodes) as unknown as CanvasGraphNode[];
  const edges = useStore((s) => s.edges) as unknown as CanvasGraphEdge[];
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling, activeKey, deliveredAfterCancelNotice } =
    useIdempotentSubmit(`canvas:image:${id}`);
  const { cancelAllowed } = useGenerationStatusPoll(activeKey);
  const { balance, refetch: refetchCredits } = useCreditBalance();
  const { imageCredits } = usePricing();
  const features = useCanvasImageFeatures();
  const freshGraph = useFreshCanvasGraph(id, data);

  const { url: signedUrl, failed: mediaFailed } = useSignedMediaUrlState(
    data.resultStoragePath,
    data.resultUrl
  );
  const previewUrl = localPreview ?? signedUrl ?? data.resultUrl;
  const origin = useCanvasAssetOrigin(data.resultStoragePath, data.creationId, "image");

  // What Generate sends. Render, Generate and a chain run all resolve inputs here.
  const resolveInputs = (
    graphNodes: CanvasGraphNode[],
    graphEdges: CanvasGraphEdge[],
    nodeData: ImageNodeData
  ) => {
    const connectedPrompt =
      findUpstreamPromptTexts(graphNodes, graphEdges, id).join("\n\n") || null;
    const refImages = usableCanvasRefImages(
      mergeCanvasImages(
        findUpstreamImages(graphNodes, graphEdges, id),
        mentionedCanvasImages(nodeData.prompt, graphNodes)
      )
    ).slice(0, MAX_CANVAS_REF_IMAGES);
    const hasImageRefs = refImages.some((image) => image.resultStoragePath || image.resultUrl);
    const prompt =
      resolveCanvasMentionPrompt(nodeData.prompt.trim(), graphNodes) || connectedPrompt || "";
    const photoTiers = canvasImageTierOptions(hasImageRefs, features.data);
    const tierValid = photoTiers.some((t) => t.id === nodeData.modelTier);
    const tier = getProductPhotoTier(nodeData.modelTier);
    const quality = nodeData.quality ?? DEFAULT_PRODUCT_PHOTO_QUALITY;
    const cost = imageCredits(photoTierPricingKey(tier, nodeData.resolution, quality), 1);
    const limitError = photoPromptLimitError(prompt);
    const canGenerate = prompt.length > 0 && !limitError && !nodeData.uploading && tierValid;
    return { refImages, hasImageRefs, prompt, photoTiers, tierValid, tier, quality, cost, limitError, canGenerate };
  };

  const connectedPromptSources = findUpstreamPrompts(nodes, edges, id);
  const { refImages, photoTiers, tierValid, tier, quality, cost, limitError, canGenerate } =
    resolveInputs(nodes, edges, data);
  const tiersReady = features.data !== null;

  const patch = (next: Partial<ImageNodeData>) => updateNodeData(id, next);

  // Snap to an enabled tier once enablement is known (never before).
  const snapTier =
    tiersReady && !tierValid
      ? snapCanvasImageTier(data.modelTier, photoTiers, features.data)
      : null;
  useEffect(() => {
    if (snapTier && snapTier !== data.modelTier) {
      updateNodeData(id, { modelTier: snapTier as ProductPhotoModelTier });
    }
  }, [snapTier, data.modelTier, id, updateNodeData]);

  const handleUpload = async (file: File) => {
    if (localPreview) URL.revokeObjectURL(localPreview);
    const preview = URL.createObjectURL(file);
    setLocalPreview(preview);
    setLocalPng(file.type === "image/png" || /\.png$/i.test(file.name));
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
      setLocalPng(false);
    } catch (err) {
      patch({
        uploading: false,
        error: err instanceof Error ? err.message : "Upload failed.",
      });
    }
  };

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

    const { refImages, tier, quality, prompt } = input;
    const nodeData = graph.data;
    const modelTier = input.photoTiers.some((t) => t.id === nodeData.modelTier)
      ? nodeData.modelTier
      : input.photoTiers[0]?.id ?? nodeData.modelTier;
    const formData = new FormData();
    formData.append("poseId", DEFAULT_MODEL_POSE);
    formData.append("styleId", DEFAULT_PHOTO_STYLE);
    formData.append("modelTier", modelTier);
    formData.append("aspectRatio", nodeData.aspectRatio);
    if (tier.hasResolution) formData.append("resolution", nodeData.resolution);
    if (tier.qualities) formData.append("quality", quality);
    formData.append("prompt", prompt);
    formData.append("mode", "image");

    let resolvedRefFrameCount = 0;
    if (refImages.length > 0) {
      try {
        const frames = await resolveCanvasRefFrames(refImages);
        resolvedRefFrameCount = frames.length;
        for (const [index, frame] of Array.from(frames.entries())) {
          const file = await blobFileFromUrl(frame.url, `reference-${index + 1}.jpg`);
          formData.append("reference", file);
        }
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

    const signature = canvasImageAttemptSignature({
      prompt,
      modelTier,
      aspectRatio: nodeData.aspectRatio,
      resolution: tier.hasResolution ? nodeData.resolution : null,
      quality: tier.qualities ? quality : null,
      refImageIds: refImages.map((image) => image.id),
      resolvedRefFrameCount,
    });
    const attempt = beginSubmit(signature);
    if (!attempt) return "busy";

    let rotateKey = false;
    let outcome: CanvasRunOutcome = "failed";
    patch({ loading: true, error: null });
    try {
      const response = await fetch("/api/generate-photo", {
        method: "POST",
        headers: { "Idempotency-Key": attempt.key },
        body: formData,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && result.code === "GENERATION_CANCELLED") {
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
        throw new Error(result.error || describeGenerateHttpError(response.status));
      }
      attempt.settle(true);
      refetchCredits();
      const storagePath = pickGenerateStoragePath(result);
      patch({
        loading: false,
        error: deliveredAfterCancelNotice(),
        imported: false,
        resultUrl: result.imageUrl ?? null,
        resultStoragePath: storagePath,
        creationId: pickGenerateCreationId(result),
        runFingerprint: fingerprint,
        lastRunError: undefined,
      });
      return "done";
    } catch (err) {
      attempt.settle(false, { rotate: rotateKey });
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
      const imageComing = deps.some((node) => node.data.kind === "image" && pending.has(node.id));
      if (graph.data.uploading || deps.some((node) => node.data.uploading)) {
        return "A connected image is still uploading.";
      }
      if (!input.prompt && !textComing) return "Add a prompt or connect a Text node.";
      if (input.limitError && !textComing) return input.limitError;
      if (features.data === null) return "Models are still loading. Try again in a moment.";
      const tiers = canvasImageTierOptions(input.hasImageRefs || imageComing, features.data);
      if (!tiers.some((t) => t.id === graph.data.modelTier)) {
        return `${input.tier.modelLabel} isn't available for this input. Pick another model.`;
      }
      return null;
    },
  });

  return (
    <CanvasNodeFrame
      kind="image"
      title={data.label.trim() || CANVAS_KIND_LABELS.image}
      selected={selected}
      sourceId={id}
      onRemove={() => void deleteElements({ nodes: [{ id }] })}
      asset={
        <CanvasMediaBox
          kind="image"
          url={previewUrl}
          checkerboard={localPng || isPngAsset(previewUrl, data.resultStoragePath)}
          onOpen={
            previewUrl && !data.loading
              ? () =>
                  openPreview({
                    kind: "image",
                    url: previewUrl,
                    checkerboard: localPng || isPngAsset(previewUrl, data.resultStoragePath),
                    createdBy: origin.createdBy,
                    onShowInLibrary: origin.onShowInLibrary,
                  })
              : undefined
          }
          empty={
            <div className="flex h-full flex-col items-center justify-center gap-2 text-text-secondary">
              <ImageIcon className="h-8 w-8 text-icon-low-emphasis" />
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
                      mediaType: "image",
                      onPick: (item) => {
                        if (localPreview) URL.revokeObjectURL(localPreview);
                        setLocalPreview(null);
                        setLocalPng(false);
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
                accept="image/*"
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
            placeholder="Describe the image…  Type @ to mention a node"
            disabled={data.loading || data.uploading}
          />
          <div className={`${STUDIO_CHIP_ROW_CLASS} mb-2`}>
            {tiersReady ? (
              photoTiers.length > 0 && (
                <ChipDropdown
                  icon={<Cpu className="h-3.5 w-3.5" />}
                  value={tier.modelLabel}
                  options={photoTiers.map((t) => ({
                    id: t.id,
                    label: t.modelLabel,
                    hint: photoTierPriceHint(t, imageCredits),
                  }))}
                  activeId={data.modelTier}
                  square
                  onSelect={(next) => patch({ modelTier: next as ProductPhotoModelTier })}
                />
              )
            ) : (
              <div className="h-8 w-28 animate-pulse rounded-lg bg-white/5" aria-hidden />
            )}
            <ChipDropdown
              icon={<Crop className="h-3.5 w-3.5" />}
              value={photoAspectRatioDisplayForTier(tier, data.aspectRatio)}
              options={photoAspectRatioOptionsForTier(tier).map((r) => ({ id: r.id, label: r.label }))}
              activeId={photoAspectRatioDisplayForTier(tier, data.aspectRatio)}
              square
              onSelect={(next) => patch({ aspectRatio: next as PhotoAspectRatio })}
            />
            {tier.qualities && (
              <ChipDropdown
                icon={<Sparkles className="h-3.5 w-3.5" />}
                value={tier.qualities.find((q) => q.id === quality)?.label ?? "Quality"}
                options={tier.qualities.map((q) => ({
                  id: q.id,
                  label: q.label,
                  hint: `${imageCredits(q.pricingKey, 1)}`,
                }))}
                activeId={quality}
                square
                onSelect={(next) => patch({ quality: next as ProductPhotoQuality })}
              />
            )}
            {tier.hasResolution && (
              <ChipDropdown
                icon={<Clock className="h-3.5 w-3.5" />}
                value={data.resolution.toUpperCase()}
                options={tier.resolutions.map((r) => ({
                  id: r.id,
                  label: r.label,
                  hint: `${imageCredits(r.pricingKey, 1)}`,
                }))}
                activeId={data.resolution}
                square
                onSelect={(next) => patch({ resolution: next as ProductPhotoResolution })}
              />
            )}
          </div>
          {limitError && (
            <p role="alert" className="mb-2 flex items-start gap-1.5 text-[11px] text-error">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {limitError}
            </p>
          )}
          {features.status === "error" && !tiersReady && (
            <p role="alert" className="mb-2 text-[11px] text-error">
              Couldn&apos;t load available models. Try again in a moment.
            </p>
          )}
          {tiersReady && photoTiers.length === 0 && (
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
