"use client";

import { useCallback, useMemo, useState } from "react";
import { useGenerationStatusPoll } from "@/lib/use-generation-status-poll";
import { useIdempotentSubmit } from "@/lib/use-idempotent-submit";
import {
  isStudioGenerationCancelledError,
  runStudioGenerationResume,
  runStudioGenerationSubmit,
  type StudioGenerationSubmitEffects,
  type StudioGenerationSubmitOptions,
} from "@/lib/studio-generation-submit-core";

export type UseStudioGenerationSubmitConfig = Omit<StudioGenerationSubmitEffects, "clearError"> & {
  resumeStillFailingMessage?: string;
};

export type StudioGenerationSubmitFn = (
  signature: string,
  execute: (idempotencyKey: string) => Promise<Response>,
  options?: StudioGenerationSubmitOptions,
) => Promise<boolean>;

export function useStudioGenerationSubmit(config: UseStudioGenerationSubmitConfig) {
  const { refetchCredits, refreshHistory, openPreviewFromResponse, resumeStillFailingMessage } =
    config;

  const { begin, cancel, cancelling, activeKey } = useIdempotentSubmit();
  const { cancelAllowed, phase } = useGenerationStatusPoll(activeKey);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoverableJobId, setRecoverableJobId] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);

  const effects = useMemo<StudioGenerationSubmitEffects>(
    () => ({
      clearError,
      refetchCredits,
      refreshHistory,
      openPreviewFromResponse,
    }),
    [clearError, refetchCredits, refreshHistory, openPreviewFromResponse],
  );

  const submit: StudioGenerationSubmitFn = useCallback(
    async (signature, execute, options = {}) => {
      const attempt = begin(signature);
      if (!attempt) return false;

      setLoading(true);
      setError(null);
      setRecoverableJobId(null);

      try {
        const response = await execute(attempt.key);
        const result = await runStudioGenerationSubmit(
          response,
          attempt.key,
          attempt,
          effects,
          options,
        );

        if (result.kind === "recoverable") {
          setRecoverableJobId(result.jobId);
          setError(result.message);
          return false;
        }
        if (result.kind === "error") {
          setError(result.message);
          return false;
        }
        return result.kind === "success";
      } catch (err: unknown) {
        if (isStudioGenerationCancelledError(err)) {
          attempt.settle(false);
          effects.clearError();
          refetchCredits();
          return false;
        }
        attempt.settle(false);
        setError(
          err instanceof Error
            ? err.message
            : options.unexpectedErrorFallback ?? "An unexpected error occurred",
        );
        return false;
      } finally {
        setLoading(false);
      }
    },
    [begin, effects, refetchCredits],
  );

  const resumeRecoverable = useCallback(async () => {
    if (!recoverableJobId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/generations/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: recoverableJobId }),
      });
      const result = await runStudioGenerationResume(
        response,
        effects,
        resumeStillFailingMessage,
      );
      if (result.kind === "still_recoverable") {
        setError(result.message);
        return;
      }
      if (result.kind === "error") {
        setError(result.message);
        return;
      }
      setRecoverableJobId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Resume failed");
    } finally {
      setLoading(false);
    }
  }, [effects, recoverableJobId, resumeStillFailingMessage]);

  return {
    loading,
    error,
    clearError,
    recoverableJobId,
    submit,
    resumeRecoverable,
    cancel,
    cancelling,
    cancelAllowed,
    phase,
    activeKey,
  };
}
