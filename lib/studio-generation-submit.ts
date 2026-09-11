"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGenerationStatusPoll } from "@/lib/use-generation-status-poll";
import { useIdempotentSubmit } from "@/lib/use-idempotent-submit";
import {
  createStudioGenerationSubmitLock,
  guardStudioGenerationSubmitEffects,
  isStudioGenerationCancelledError,
  isStudioGenerationPendingError,
  runStudioGenerationResume,
  runStudioGenerationSubmit,
  type StudioGenerationSubmitEffects,
  type StudioGenerationSubmitOptions,
} from "@/lib/studio-generation-submit-core";

export type UseStudioGenerationSubmitConfig = Omit<StudioGenerationSubmitEffects, "clearError"> & {
  idempotencyScope: string;
  resumeStillFailingMessage?: string;
};

export type StudioGenerationSubmitFn = (
  signature: string,
  execute: (idempotencyKey: string) => Promise<Response>,
  options?: StudioGenerationSubmitOptions,
) => Promise<boolean>;

export function useStudioGenerationSubmit(config: UseStudioGenerationSubmitConfig) {
  const {
    idempotencyScope,
    refetchCredits,
    refreshHistory,
    openPreviewFromResponse,
    resumeStillFailingMessage,
  } = config;

  const { begin, cancel, cancelling, activeKey } = useIdempotentSubmit(idempotencyScope);
  const { cancelAllowed, phase } = useGenerationStatusPoll(activeKey);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoverableJobId, setRecoverableJobId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const resumeLockRef = useRef(createStudioGenerationSubmitLock());
  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const effects = useMemo<StudioGenerationSubmitEffects>(
    () =>
      guardStudioGenerationSubmitEffects(
        () => mountedRef.current,
        {
          clearError,
          refetchCredits,
          refreshHistory,
          openPreviewFromResponse,
        },
      ),
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
        const guardedOptions =
          options.onSuccess
            ? {
                ...options,
                onSuccess: async (data: Parameters<NonNullable<typeof options.onSuccess>>[0]) => {
                  if (mountedRef.current) await options.onSuccess?.(data);
                },
              }
            : options;
        const result = await runStudioGenerationSubmit(
          response,
          attempt.key,
          attempt,
          effects,
          guardedOptions,
        );

        if (result.kind === "recoverable") {
          if (mountedRef.current) {
            setRecoverableJobId(result.jobId);
            setError(result.message);
          }
          return false;
        }
        if (result.kind === "error") {
          if (mountedRef.current) setError(result.message);
          return false;
        }
        return result.kind === "success";
      } catch (err: unknown) {
        if (isStudioGenerationPendingError(err)) {
          if (mountedRef.current) setError(err.message);
          return false;
        }
        if (isStudioGenerationCancelledError(err)) {
          attempt.settle(false);
          effects.clearError();
          effects.refetchCredits();
          return false;
        }
        attempt.settle(false);
        if (mountedRef.current) {
          setError(
            err instanceof Error
              ? err.message
              : options.unexpectedErrorFallback ?? "An unexpected error occurred",
          );
        }
        return false;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [begin, effects],
  );

  const resumeRecoverable = useCallback(async () => {
    if (
      !mountedRef.current ||
      !recoverableJobId ||
      !resumeLockRef.current.acquire()
    ) {
      return;
    }
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
        if (mountedRef.current) setError(result.message);
        return;
      }
      if (result.kind === "error") {
        if (mountedRef.current) setError(result.message);
        return;
      }
      if (mountedRef.current) setRecoverableJobId(null);
    } catch (err: unknown) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Resume failed");
      }
    } finally {
      resumeLockRef.current.release();
      if (mountedRef.current) setLoading(false);
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
