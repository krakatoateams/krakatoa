"use client";

import { useReactFlow, useStore, type Node, type NodeProps } from "@xyflow/react";
import { AlertCircle, Cpu } from "lucide-react";
import {
  CreditActionButton,
  GENERATE_BTN_CLASS,
  GenerationCancelButton,
  ChipDropdown,
  STUDIO_CHIP_ROW_CLASS,
} from "@/components/studio";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { usePricing } from "@/app/(app)/pricing-context";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useIdempotentSubmit } from "@/lib/use-idempotent-submit";
import { useGenerationStatusPoll } from "@/lib/use-generation-status-poll";
import {
  CANVAS_KIND_LABELS,
  findUpstreamImages,
  findUpstreamPrompts,
  findUpstreamPromptTexts,
  mentionedCanvasImages,
  mergeCanvasImages,
  resolveCanvasMentionPrompt,
  usableCanvasRefImages,
  canvasRefStoragePaths,
  MAX_CANVAS_REF_IMAGES,
  type CanvasGraphEdge,
  type CanvasGraphNode,
} from "@/lib/canvas-graph";
import { describeCanvasIdempotencyError } from "../canvas-api";
import {
  CANVAS_TEXT_MODELS,
  getCanvasTextModel,
  type CanvasTextModelId,
} from "@/lib/canvas-text-models";
import { useCanvasActions } from "../canvas-actions";
import CanvasNodeFrame from "./CanvasNodeFrame";
import CanvasOmniForm from "./CanvasOmniForm";
import CanvasSourceRefs from "./CanvasSourceRefs";
import CanvasMentionField from "./CanvasMentionField";
import type { PromptNodeData } from "../node-data";

export type PromptFlowNode = Node<PromptNodeData, "prompt">;

export default function PromptNode({
  id,
  data,
  selected,
}: NodeProps<PromptFlowNode>) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const { pushHistory } = useCanvasActions();
  const nodes = useStore((s) => s.nodes) as unknown as CanvasGraphNode[];
  const edges = useStore((s) => s.edges) as unknown as CanvasGraphEdge[];
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling, activeKey } = useIdempotentSubmit();
  const { cancelAllowed } = useGenerationStatusPoll(activeKey);
  const { balance, refetch: refetchCredits } = useCreditBalance();
  const { canvasTextCredits } = usePricing();

  const connectedPromptSources = findUpstreamPrompts(nodes, edges, id);
  const connectedPrompts = findUpstreamPromptTexts(nodes, edges, id);
  const connectedImages = findUpstreamImages(nodes, edges, id);
  const mentionedImages = mentionedCanvasImages(data.prompt, nodes);
  const refImages = usableCanvasRefImages(
    mergeCanvasImages(connectedImages, mentionedImages)
  ).slice(0, MAX_CANVAS_REF_IMAGES);
  const connectedPrompt = connectedPrompts.join("\n\n") || null;
  const imageStoragePaths = canvasRefStoragePaths(refImages);
  const selectedModel = getCanvasTextModel(data.modelId);
  const textModel =
    imageStoragePaths.length > 0 && !selectedModel.vision
      ? getCanvasTextModel("gpt5")
      : selectedModel;
  const cost = canvasTextCredits();
  const instruction = data.prompt.trim();
  const resolvedInstruction = resolveCanvasMentionPrompt(instruction, nodes);
  const canGenerate =
    (resolvedInstruction.length > 0 ||
      !!connectedPrompt ||
      imageStoragePaths.length > 0) &&
    !data.loading;

  const patch = (next: Partial<PromptNodeData>) => updateNodeData(id, next);

  const handleGenerate = async () => {
    if (!canGenerate) return;
    if (status !== "authenticated") {
      openSignInModal();
      return;
    }

    if (refImages.length > 0 && imageStoragePaths.length < refImages.length) {
      patch({
        error: "A connected image isn't ready to send. Wait for the upload to finish, then try again.",
      });
      return;
    }

    const upstreamText =
      connectedPrompt && connectedPrompt !== resolvedInstruction ? connectedPrompt : "";
    const signature = [
      resolvedInstruction,
      upstreamText,
      imageStoragePaths.join(","),
      textModel.id,
    ].join("|");
    const attempt = beginSubmit(signature);
    if (!attempt) return;

    pushHistory();
    patch({ loading: true, error: null });
    try {
      const response = await fetch("/api/generate-canvas-text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: JSON.stringify({
          prompt: resolvedInstruction || instruction,
          upstreamText: upstreamText || undefined,
          modelId: textModel.id,
          imageStoragePaths,
          imageStoragePath: imageStoragePaths[0],
          imageLabels: refImages.map((image) => {
            const node = nodes.find((item) => item.id === image.id);
            return node?.data.label?.trim() || "Image";
          }),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
        code?: string;
        requiredCredits?: number;
        currentBalance?: number;
      };
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
      const nextText = result.text?.trim();
      if (!nextText) throw new Error("Model returned an empty prompt.");
      attempt.settle(true);
      refetchCredits();
      patch({ loading: false, error: null, text: nextText });
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
      kind="prompt"
      title={data.label.trim() || CANVAS_KIND_LABELS.prompt}
      selected={selected}
      sourceId={id}
      onRemove={() => void deleteElements({ nodes: [{ id }] })}
      asset={
        <div className="relative min-h-[120px]">
          <textarea
            value={data.text}
            onChange={(event) => patch({ text: event.target.value })}
            placeholder="Type or generate text…"
            rows={5}
            disabled={data.loading}
            className="nodrag nowheel min-h-[120px] w-full resize-y bg-transparent text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-secondary disabled:opacity-60"
          />
          {data.loading && (
            <div className="absolute inset-0 animate-pulse rounded-xl bg-white/10" />
          )}
        </div>
      }
      form={
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
            placeholder="Describe the text you want to generate…  Type @ to mention a node"
            disabled={data.loading}
          />
          <div className={`${STUDIO_CHIP_ROW_CLASS} mb-2`}>
            <ChipDropdown
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={textModel.label}
              options={CANVAS_TEXT_MODELS.filter(
                (model) => imageStoragePaths.length === 0 || model.vision
              ).map((model) => ({ id: model.id, label: model.label }))}
              activeId={textModel.id}
              square
              onSelect={(next) => patch({ modelId: next as CanvasTextModelId })}
            />
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
      }
    />
  );
}
