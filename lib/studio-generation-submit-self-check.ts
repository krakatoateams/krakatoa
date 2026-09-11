import { STUDIO_GENERATION_RECOVERABLE_FALLBACK } from "./studio-generation-response";
import {
  applyStudioGenerationOutcome,
  runStudioGenerationResume,
  runStudioGenerationSubmit,
  type StudioGenerationSubmitAttempt,
  type StudioGenerationSubmitEffects,
} from "./studio-generation-submit-core";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`studio-generation-submit self-check: ${message}`);
}

function fakeResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

function collectAttempt(): StudioGenerationSubmitAttempt & { settled: boolean | null } {
  const attempt: StudioGenerationSubmitAttempt & { settled: boolean | null } = {
    settled: null,
    settle(succeeded: boolean) {
      attempt.settled = succeeded;
    },
  };
  return attempt;
}

function collectEffects(): StudioGenerationSubmitEffects & {
  previewCalls: unknown[];
  historyCalls: number;
  creditCalls: number;
} {
  const effects: StudioGenerationSubmitEffects & {
    previewCalls: unknown[];
    historyCalls: number;
    creditCalls: number;
  } = {
    previewCalls: [],
    historyCalls: 0,
    creditCalls: 0,
    refetchCredits() {
      effects.creditCalls += 1;
    },
    refreshHistory() {
      effects.historyCalls += 1;
    },
    openPreviewFromResponse(data: unknown) {
      effects.previewCalls.push(data);
    },
  };
  return effects;
}

/** ponytail: pure injected runner — no React, no network. */
export async function studioGenerationSubmitSelfCheck(): Promise<void> {
  {
    const attempt = collectAttempt();
    const effects = collectEffects();
    const result = await runStudioGenerationSubmit(
      fakeResponse(200, JSON.stringify({ historyItem: { id: "c-1" } })),
      "key-1",
      attempt,
      effects,
    );
    assert(result.kind === "success", "200 → success");
    assert(attempt.settled === true, "success settles true");
    assert(effects.previewCalls.length === 1, "preview once");
    assert(effects.historyCalls === 1, "history once");
    assert(effects.creditCalls === 1, "credits once");
    assert(
      effects.previewCalls[0] === effects.previewCalls[0] &&
        JSON.stringify(effects.previewCalls[0]) === JSON.stringify({ historyItem: { id: "c-1" } }),
      "preview payload",
    );
  }

  {
    const attempt = collectAttempt();
    const effects = collectEffects();
    const result = await runStudioGenerationSubmit(
      fakeResponse(409, JSON.stringify({ code: "GENERATION_CANCELLED" })),
      "key-2",
      attempt,
      effects,
    );
    assert(result.kind === "cancelled", "cancelled outcome");
    assert(attempt.settled === false, "cancelled settles false");
    assert(effects.creditCalls === 1, "cancelled refetches credits");
    assert(effects.previewCalls.length === 0, "cancelled skips preview");
  }

  {
    const attempt = collectAttempt();
    const effects = collectEffects();
    const result = await runStudioGenerationSubmit(
      fakeResponse(402, JSON.stringify({ requiredCredits: 10, currentBalance: 2 })),
      "key-3",
      attempt,
      effects,
    );
    assert(result.kind === "error", "402 → error result");
    assert(
      result.kind === "error" &&
        result.message === "Insufficient credits. Required: 10, current: 2.",
      "402 exact message",
    );
    assert(attempt.settled === false, "402 settles false");
  }

  {
    const attempt = collectAttempt();
    const effects = collectEffects();
    const result = await runStudioGenerationSubmit(
      fakeResponse(503, JSON.stringify({ recoverable: true, jobId: "job-x", error: "Rendi down" })),
      "key-4",
      attempt,
      effects,
    );
    assert(result.kind === "recoverable" && result.jobId === "job-x", "503 recoverable");
    assert(result.kind === "recoverable" && result.message === "Rendi down", "recoverable message");
    assert(attempt.settled === false, "recoverable settles false");
  }

  {
    const attempt = collectAttempt();
    const effects = collectEffects();
    const result = await runStudioGenerationSubmit(
      fakeResponse(500, JSON.stringify({ recoverable: true, jobId: "job-reels" })),
      "key-5",
      attempt,
      effects,
      {
        recoverableMessage: "Scene videos finished but editing failed. Credits stay on hold — tap Try again.",
      },
    );
    assert(
      result.kind === "recoverable" &&
        result.message ===
          "Scene videos finished but editing failed. Credits stay on hold — tap Try again.",
      "recoverable message override",
    );
  }

  {
    const attempt = collectAttempt();
    const effects = collectEffects();
    let polled = false;
    const result = await runStudioGenerationSubmit(
      fakeResponse(202, JSON.stringify({ status: "processing" })),
      "key-6",
      attempt,
      effects,
      {
        awaitCompletion: async () => {
          polled = true;
          return { videoUrl: "https://x/v.mp4" };
        },
      },
    );
    assert(polled, "202 triggers awaitCompletion");
    assert(result.kind === "success", "202 completion → success");
    assert(attempt.settled === true, "202 completion settles true");
  }

  {
    const attempt = collectAttempt();
    const effects = collectEffects();
    const order: string[] = [];
    await runStudioGenerationSubmit(
      fakeResponse(200, JSON.stringify({ id: "ok" })),
      "key-7",
      {
        settle(succeeded) {
          order.push("settle");
          attempt.settle(succeeded);
        },
      },
      {
        ...effects,
        openPreviewFromResponse(data) {
          order.push("preview");
          effects.openPreviewFromResponse(data);
        },
        refreshHistory() {
          order.push("history");
          effects.refreshHistory();
        },
        refetchCredits() {
          order.push("credits");
          effects.refetchCredits();
        },
      },
      {
        onSuccess: async () => {
          order.push("cleanup");
        },
      },
    );
    assert(
      order.join(",") === "settle,preview,history,credits,cleanup",
      "success side-effect order",
    );
  }

  {
    const attempt = collectAttempt();
    const effects = collectEffects();
    try {
      await runStudioGenerationSubmit(fakeResponse(504, ""), "key-8", attempt, effects);
      assert(false, "empty error body should throw");
    } catch (err) {
      assert(
        err instanceof Error &&
          err.message.includes("timed out") &&
          err.message.includes("history"),
        "timeout parse propagates",
      );
    }
  }

  {
    const effects = collectEffects();
    const resume = await runStudioGenerationResume(
      fakeResponse(200, JSON.stringify({ historyItem: { id: "r-1" } })),
      effects,
    );
    assert(resume.kind === "success", "resume success");
    assert(effects.previewCalls.length === 1, "resume previews");
  }

  {
    const effects = collectEffects();
    const resume = await runStudioGenerationResume(
      fakeResponse(503, JSON.stringify({ code: "PIPELINE_RECOVERABLE", error: "Still broken" })),
      effects,
      "Upload still failing. Try again in a moment.",
    );
    assert(resume.kind === "still_recoverable", "resume still recoverable");
    assert(
      resume.kind === "still_recoverable" && resume.message === "Still broken",
      "resume uses server error",
    );
  }

  {
    const attempt = collectAttempt();
    const effects = collectEffects();
    await applyStudioGenerationOutcome(
      409,
      { code: "GENERATION_IN_PROGRESS" },
      attempt,
      effects,
    );
    assert(attempt.settled === false, "in-progress settles false");
  }

  {
    const attempt = collectAttempt();
    const effects = collectEffects();
    const result = await applyStudioGenerationOutcome(
      500,
      { recoverable: true, jobId: "j1" },
      attempt,
      effects,
    );
    assert(result.kind === "recoverable", "apply recoverable");
    assert(
      result.kind === "recoverable" && result.message === STUDIO_GENERATION_RECOVERABLE_FALLBACK,
      "recoverable fallback message",
    );
  }
}

if (process.argv[1]?.includes("studio-generation-submit-self-check")) {
  studioGenerationSubmitSelfCheck()
    .then(() => {
      console.log("studio-generation-submit self-check ok");
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
