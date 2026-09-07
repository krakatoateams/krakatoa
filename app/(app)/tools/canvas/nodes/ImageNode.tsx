"use client";

import { useMemo, useRef, useState } from "react";
import { useReactFlow, useStore, type Node, type NodeProps } from "@xyflow/react";
import { AlertCircle, Clock, Cpu, Crop, ImageIcon } from "lucide-react";
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
  DEFAULT_MODEL_POSE,
  DEFAULT_PHOTO_STYLE,
  PHOTO_ASPECT_RATIOS,
  PRODUCT_PHOTO_TIERS,
  getProductPhotoTier,
  type PhotoAspectRatio,
  type ProductPhotoModelTier,
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
  pickGenerateCreationId,
  resolveCanvasRefFrames,
} from "../canvas-api";
import CanvasNodeFrame from "./CanvasNodeFrame";
import CanvasOmniForm from "./CanvasOmniForm";
import CanvasSourceRefs from "./CanvasSourceRefs";
import CanvasMentionField from "./CanvasMentionField";
import CanvasMediaBox, { isPngAsset } from "./CanvasMediaBox";
import CanvasAssetActions from "./CanvasAssetActions";
import { useCanvasPreview } from "../CanvasPreview";
import { useCanvasLibrary } from "../CanvasLibraryPicker";
import type { ImageNodeData } from "../node-data";

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
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling, activeKey } = useIdempotentSubmit();
  const { cancelAllowed } = useGenerationStatusPoll(activeKey);
  const { balance, refetch: refetchCredits } = useCreditBalance();
  const { imageCredits } = usePricing();

  const signedUrl = useSignedMediaUrl(data.resultStoragePath, data.resultUrl);
  const previewUrl = localPreview ?? signedUrl ?? data.resultUrl;

  const connectedPromptSources = findUpstreamPrompts(nodes, edges, id);
  const connectedPrompts = findUpstreamPromptTexts(nodes, edges, id);
  const connectedImages = findUpstreamImages(nodes, edges, id);
  const refImages = usableCanvasRefImages(
    mergeCanvasImages(connectedImages, mentionedCanvasImages(data.prompt, nodes))
  ).slice(0, MAX_CANVAS_REF_IMAGES);
  const connectedPrompt = connectedPrompts.join("\n\n") || null;
  const hasImageRefs = refImages.some((image) => image.resultStoragePath || image.resultUrl);
  const prompt =
    resolveCanvasMentionPrompt(data.prompt.trim(), nodes) || connectedPrompt || "";
  const photoTiers = useMemo(
    () =>
      hasImageRefs
        ? PRODUCT_PHOTO_TIERS.filter((t) => t.supportsReference)
        : PRODUCT_PHOTO_TIERS,
    [hasImageRefs]
  );
  const tier = getProductPhotoTier(data.modelTier);
  const photoPricingKey = tier.hasResolution
    ? tier.resolutions.find((r) => r.id === data.resolution)?.pricingKey ??
      tier.resolutions[0].pricingKey
    : tier.basicPricingKey!;
  const cost = imageCredits(photoPricingKey, 1);
  const canGenerate = prompt.length > 0 && !data.uploading && photoTiers.length > 0;

  const patch = (next: Partial<ImageNodeData>) => updateNodeData(id, next);

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

  const handleGenerate = async () => {
    if (!canGenerate) return;
    if (status !== "authenticated") {
      openSignInModal();
      return;
    }

    const modelTier = photoTiers.some((t) => t.id === data.modelTier)
      ? data.modelTier
      : photoTiers[0]?.id ?? data.modelTier;
    const formData = new FormData();
    formData.append("poseId", DEFAULT_MODEL_POSE);
    formData.append("styleId", DEFAULT_PHOTO_STYLE);
    formData.append("modelTier", modelTier);
    formData.append("aspectRatio", data.aspectRatio);
    if (tier.hasResolution) formData.append("resolution", data.resolution);
    formData.append("prompt", prompt);
    formData.append("mode", "image");

    if (refImages.length > 0) {
      try {
        const frames = await resolveCanvasRefFrames(refImages);
        for (const [index, frame] of Array.from(frames.entries())) {
          const file = await blobFileFromUrl(frame.url, `reference-${index + 1}.jpg`);
          formData.append("reference", file);
        }
      } catch (err) {
        patch({
          error: err instanceof Error ? err.message : "Couldn't use the connected image.",
        });
        return;
      }
    }

    const signature = [
      prompt,
      data.modelTier,
      data.aspectRatio,
      data.resolution,
      refImages.map((image) => image.id).join(","),
    ].join("|");
    const attempt = beginSubmit(signature);
    if (!attempt) return;

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
        resultUrl: result.imageUrl ?? null,
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
                  })
              : undefined
          }
          empty={
            <div className="flex h-full flex-col items-center justify-center gap-2 text-text-secondary">
              <ImageIcon className="h-8 w-8 text-icon-low-emphasis" />
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
            <ChipDropdown
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={tier.modelLabel}
              options={photoTiers.map((t) => ({ id: t.id, label: t.modelLabel }))}
              activeId={data.modelTier}
              square
              onSelect={(next) => patch({ modelTier: next as ProductPhotoModelTier })}
            />
            <ChipDropdown
              icon={<Crop className="h-3.5 w-3.5" />}
              value={data.aspectRatio}
              options={PHOTO_ASPECT_RATIOS.map((r) => ({ id: r.id, label: r.label }))}
              activeId={data.aspectRatio}
              square
              onSelect={(next) => patch({ aspectRatio: next as PhotoAspectRatio })}
            />
            {tier.hasResolution && (
              <ChipDropdown
                icon={<Clock className="h-3.5 w-3.5" />}
                value={data.resolution.toUpperCase()}
                options={tier.resolutions.map((r) => ({ id: r.id, label: r.label }))}
                activeId={data.resolution}
                square
                onSelect={(next) => patch({ resolution: next as ProductPhotoResolution })}
              />
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
