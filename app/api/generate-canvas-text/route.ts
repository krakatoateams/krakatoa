import { NextResponse } from "next/server";
import { createReplicateClient, runWithRetry } from "@/lib/replicate-utils";
import {
  flattenReplicateTextChunks,
  isCancellation,
  stripMarkdownFences,
} from "@/lib/replicate-server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { createJob, startJob, finishJob, failJob, cancelJob } from "@/lib/jobs-db";
import { createJobStep, finishJobStep, failJobStep } from "@/lib/job-steps-db";
import {
  spendCredits,
  refundCredits,
  getWallet,
  InsufficientCreditsError,
} from "@/lib/credits-db";
import { getCanvasTextCredits, PricingConfigError } from "@/lib/pricing-resolver";
import { replicateRef } from "@/lib/model-resolver";
import {
  buildCanvasTextProviderInput,
  getCanvasTextModel,
} from "@/lib/canvas-text-models";
import { assertToolEnabled, ToolDisabledError } from "@/lib/tool-access";
import { recordUsageEvent } from "@/lib/usage-events-db";
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  computeRequestHash,
  beginGenerationRequest,
  attachGenerationRequestJob,
  finishGenerationRequestSuccess,
  finishGenerationRequestFailure,
} from "@/lib/generation-idempotency";
import { assertNotCancelled, makeReplicateCancelHooks } from "@/lib/generation-cancel";
import {
  markProviderCommitted,
  isRefundableUserCancellation,
  isProviderCommitLocked,
} from "@/lib/generation-commit";
import { shouldRefundSpentCreditsAfterFailure } from "@/lib/generation-commit-pure";
import { assertPathOwnedByUser } from "@/lib/storage-signed-url";
import { uploadStoragePathToReplicate } from "@/lib/replicate-product-image";

export const maxDuration = 60;

const TEXT_MAX = 8000;

function asTrimmed(raw: unknown, max = TEXT_MAX): string {
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

function asPathList(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const path = asTrimmed(item, 512);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
    if (paths.length >= 8) break;
  }
  return paths;
}

function buildCanvasTextSystem(params: { imageCount: number }): string {
  const parts = [
    "You write the text the user asked for in a canvas Text node.",
    "Follow their instruction exactly. Do not change the task into something else.",
    "Output only that text. No quotes, labels, markdown, or preamble.",
  ];
  if (params.imageCount > 0) {
    const n = params.imageCount;
    parts.push(
      `${n} photo${n === 1 ? " is" : "s are"} attached to this request. You can see ${n === 1 ? "it" : "them"}.`,
      "Describe only what is visible in the attached photo(s): people, clothing, pose, objects, setting, lighting, and colors.",
      "Never invent a different person, scene, or setting. If you cannot see a photo, say so instead of guessing."
    );
  }
  return parts.join("\n\n");
}

function buildCanvasTextPrompt(params: {
  instruction: string;
  upstreamText: string;
  imageCount: number;
}): string {
  const parts: string[] = [];
  if (params.imageCount > 0) {
    parts.push(
      params.imageCount === 1
        ? "Look at the attached photo and follow the instruction using only what you see in it."
        : "Look at every attached photo and follow the instruction using only what you see in them."
    );
  }
  if (params.instruction) {
    parts.push(params.instruction);
  } else if (params.imageCount > 0) {
    parts.push(
      params.imageCount === 1
        ? "Describe the attached photo in concrete visual detail."
        : "Describe every attached photo in concrete visual detail."
    );
  } else if (params.upstreamText) {
    parts.push("Rewrite the earlier text into a clear, specific result.");
  }
  if (params.upstreamText) {
    parts.push(`Earlier text:\n${params.upstreamText}`);
  }
  return parts.join("\n\n");
}

/**
 * POST /api/generate-canvas-text — run a Canvas Text node's instruction
 * via Gemini 2.5 Flash (vision when an image is attached). No user_creations row.
 */
export async function POST(req: Request) {
  let profileId: string | null = null;
  let jobId: string | null = null;
  let currentStepId: string | null = null;
  let creditsSpent = false;
  let creditsAmount = 0;
  let generationRequestId: string | null = null;

  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[canvas-text obs] ${label} failed:`, e);
      return null;
    }
  };

  try {
    let userId: string | null = null;
    try {
      const profile = await requireCurrentProfile();
      profileId = profile.id;
      userId = profile.user_id;
    } catch (e) {
      if (e instanceof Error && /not authenticated/i.test(e.message)) {
        return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
      }
      console.error("[canvas-text] profile resolution failed (non-auth):", e);
      return NextResponse.json(
        { error: "Profile resolution failed. Please try again." },
        { status: 500 }
      );
    }

    try {
      await assertToolEnabled("canvas");
    } catch (e) {
      if (e instanceof ToolDisabledError) {
        return NextResponse.json(
          { error: e.message, code: "TOOL_DISABLED" },
          { status: 403 }
        );
      }
      console.warn("[canvas-text] tool guard unexpected error (failing open):", e);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const b = body as Record<string, unknown>;
    const prompt = asTrimmed(b.prompt);
    const upstreamText = asTrimmed(b.upstreamText);
    const imageStoragePaths = asPathList(
      Array.isArray(b.imageStoragePaths) ? b.imageStoragePaths : b.imageStoragePath
    );

    if (!prompt && !upstreamText && imageStoragePaths.length === 0) {
      return NextResponse.json(
        { error: "Add some text, or connect an image, then generate." },
        { status: 400 }
      );
    }

    for (const imageStoragePath of imageStoragePaths) {
      try {
        await assertPathOwnedByUser(imageStoragePath, userId!);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Couldn't use the connected image.";
        const status = /forbidden/i.test(message) ? 403 : 400;
        return NextResponse.json({ error: message }, { status });
      }
    }

    const textModel = (() => {
      const selected = getCanvasTextModel(asTrimmed(b.modelId, 40));
      if (imageStoragePaths.length > 0 && !selected.vision) return getCanvasTextModel("gpt5");
      return selected;
    })();
    const llmRef = replicateRef({
      provider: textModel.provider,
      model: textModel.model,
      parameters: {},
    });

    const idemKey = readIdempotencyKey(req);
    if (!isValidIdempotencyKey(idemKey)) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required.", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 }
      );
    }
    const requestHash = computeRequestHash({
      route: "generate_canvas_text",
      prompt,
      upstreamText,
      imageStoragePaths,
      modelId: textModel.id,
    });
    const begin = await beginGenerationRequest({
      profileId: profileId!,
      idempotencyKey: idemKey,
      routeKey: "generate_canvas_text",
      toolKey: "canvas",
      requestHash,
    });
    if (begin.action === "conflict") {
      return NextResponse.json(
        {
          error: "This idempotency key was already used with a different request.",
          code: "IDEMPOTENCY_CONFLICT",
        },
        { status: 409 }
      );
    }
    if (begin.action === "in_progress") {
      return NextResponse.json(
        { error: "Generation already in progress, please wait.", code: "GENERATION_IN_PROGRESS" },
        { status: 409 }
      );
    }
    if (begin.action === "replay") {
      return NextResponse.json(begin.response);
    }
    generationRequestId = begin.id;

    const job = await safe("createJob", () =>
      createJob({
        profileId: profileId!,
        tool: "canvas",
        jobType: "canvas_text",
        provider: textModel.provider,
        model: textModel.model,
        input: {
          prompt,
          upstreamText: upstreamText || undefined,
          imageCount: imageStoragePaths.length,
          modelId: textModel.id,
        },
      })
    );
    if (job) {
      jobId = job.id;
      await safe("startJob", () => startJob(profileId!, jobId!));
      if (generationRequestId) {
        await safe("attachJob", () =>
          attachGenerationRequestJob({
            id: generationRequestId!,
            profileId: profileId!,
            jobId: job.id,
          })
        );
      }
    }

    const requiredCredits = await getCanvasTextCredits();
    try {
      await spendCredits({
        profileId: profileId!,
        amount: requiredCredits,
        idempotencyKey: jobId
          ? `spend:canvas_text:${jobId}`
          : `spend:canvas_text:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: "Canvas text generation",
        metadata: { tool: "canvas", jobType: "canvas_text", imageCount: imageStoragePaths.length },
      });
      creditsSpent = true;
      creditsAmount = requiredCredits;
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        const wallet = await getWallet(profileId!).catch(() => null);
        const currentBalance = wallet?.balance ?? 0;
        if (jobId) {
          await safe("failJobInsufficient", () =>
            failJob(profileId!, jobId!, {
              code: "INSUFFICIENT_CREDITS",
              message: "Insufficient credits.",
              requiredCredits,
              currentBalance,
            })
          );
        }
        if (generationRequestId) {
          await safe("idemFailInsufficient", () =>
            finishGenerationRequestFailure({
              id: generationRequestId!,
              profileId: profileId!,
              jobId: jobId ?? null,
              errorJson: {
                code: "INSUFFICIENT_CREDITS",
                message: "Insufficient credits.",
                requiredCredits,
                currentBalance,
              },
            })
          );
        }
        return NextResponse.json(
          { error: "Insufficient credits.", requiredCredits, currentBalance },
          { status: 402 }
        );
      }
      throw e;
    }

    const replicate = createReplicateClient();
    const replicateHooks = makeReplicateCancelHooks({
      generationRequestId,
      profileId,
      jobId,
      kind: "canvas_text",
    });

    if (generationRequestId && profileId) {
      await assertNotCancelled(profileId, generationRequestId);
    }

    const imageCount = imageStoragePaths.length;
    const imageUrls: string[] = [];
    for (const imageStoragePath of imageStoragePaths) {
      imageUrls.push(await uploadStoragePathToReplicate(replicate, imageStoragePath));
    }
    const systemInstruction = buildCanvasTextSystem({ imageCount });
    const userPrompt = buildCanvasTextPrompt({
      instruction: prompt,
      upstreamText,
      imageCount,
    });
    if (jobId && profileId) {
      const step = await safe("beginStep", () =>
        createJobStep({
          jobId: jobId!,
          profileId: profileId!,
          stepKey: "canvas_text",
          stepName: "Gemini canvas text",
          status: "running",
          input: { prompt: userPrompt, imageCount },
        })
      );
      currentStepId = step?.id ?? null;
    }

    const output = await runWithRetry(
      replicate,
      llmRef,
      {
        input: buildCanvasTextProviderInput({
          family: textModel.family,
          prompt: userPrompt,
          system: systemInstruction,
          imageUrls,
        }),
      },
      10,
      replicateHooks
    );
    const text = stripMarkdownFences(flattenReplicateTextChunks(output)).slice(0, TEXT_MAX);
    if (!text) {
      throw new Error("Model returned an empty prompt.");
    }

    if (currentStepId && profileId) {
      await safe("finishStep", () => finishJobStep(profileId!, currentStepId!, { text }));
      currentStepId = null;
    }

    if (generationRequestId && profileId) {
      await markProviderCommitted({
        generationRequestId,
        profileId,
        reason: "canvas_text",
      });
    }

    if (jobId && profileId) {
      await safe("finishJob", () =>
        finishJob(profileId!, jobId!, { output: { text }, costCredits: requiredCredits })
      );
    }
    await safe("usage", () =>
      recordUsageEvent({
        profileId: profileId!,
        tool: "canvas",
        jobId: jobId ?? null,
        provider: textModel.provider,
        model: textModel.model,
        unitType: "run",
        units: 1,
        creditsCharged: requiredCredits,
        metadata: { jobType: "canvas_text", imageCount: imageStoragePaths.length },
      })
    );

    const successResponse = { text, jobId };
    if (generationRequestId) {
      await safe("idemSuccess", () =>
        finishGenerationRequestSuccess({
          id: generationRequestId!,
          profileId: profileId!,
          jobId: jobId ?? null,
          responseJson: successResponse,
        })
      );
    }
    return NextResponse.json(successResponse);
  } catch (error: unknown) {
    const cancelled =
      profileId && generationRequestId
        ? await isRefundableUserCancellation(profileId, generationRequestId, error)
        : isCancellation(error);
    if (cancelled) console.log("[canvas-text] Cancelled by user.");
    else console.error("[canvas-text] Error:", error);
    const pricingMissing = error instanceof PricingConfigError;
    const message = cancelled
      ? "Generation cancelled."
      : error instanceof Error
        ? error.message
        : String(error ?? "Unknown error");
    const errJson = cancelled
      ? { message, code: "GENERATION_CANCELLED" }
      : pricingMissing
        ? { message, code: "PRICING_CONFIG_MISSING" }
        : { message };
    if (currentStepId && profileId) {
      await safe("failStep", () => failJobStep(profileId!, currentStepId!, errJson));
      currentStepId = null;
    }
    if (jobId && profileId) {
      if (cancelled) {
        await safe("cancelJob", () => cancelJob(profileId!, jobId!, errJson));
      } else {
        await safe("failJob", () => failJob(profileId!, jobId!, errJson));
      }
    }

    const commitLocked =
      Boolean(profileId && generationRequestId) &&
      (await isProviderCommitLocked(profileId!, generationRequestId!));
    if (
      shouldRefundSpentCreditsAfterFailure({
        creditsSpent,
        creditsAmount,
        commitLocked,
      }) &&
      profileId
    ) {
      await safe("refundCredits", () =>
        refundCredits({
          profileId: profileId!,
          amount: creditsAmount,
          idempotencyKey: jobId
            ? `refund:canvas_text:${jobId}`
            : `refund:canvas_text:profile:${profileId}:${Date.now()}`,
          jobId: jobId ?? null,
          description: cancelled
            ? "Refund after user cancellation"
            : "Best-effort refund after generation failure",
          metadata: {
            reason: cancelled ? "generation_cancelled" : "generation_failed",
            originalError: errJson,
          },
        })
      );
    }

    if (generationRequestId) {
      await safe("idemFailure", () =>
        finishGenerationRequestFailure({
          id: generationRequestId!,
          profileId: profileId!,
          jobId: jobId ?? null,
          errorJson: errJson,
        })
      );
    }

    if (cancelled) {
      return NextResponse.json(
        { error: message, code: "GENERATION_CANCELLED", refunded: creditsSpent },
        { status: 409 }
      );
    }

    return NextResponse.json(
      pricingMissing ? { error: message, code: "PRICING_CONFIG_MISSING" } : { error: message },
      { status: 500 }
    );
  }
}
