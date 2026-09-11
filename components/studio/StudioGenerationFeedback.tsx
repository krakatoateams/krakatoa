"use client";

import { AlertCircle } from "lucide-react";
import { STUDIO_GENERATION_RECOVERABLE_FALLBACK } from "@/lib/studio-generation-response";

export function StudioGenerationFeedback({
  error,
  recoverableJobId,
  loading,
  onResume,
}: {
  error: string | null;
  recoverableJobId: string | null;
  loading: boolean;
  onResume: () => void;
}) {
  if (recoverableJobId) {
    return (
      <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <span>{error ?? STUDIO_GENERATION_RECOVERABLE_FALLBACK}</span>
        </div>
        <button
          type="button"
          onClick={onResume}
          disabled={loading}
          className="rounded-xl bg-warning px-4 py-2 font-medium text-static-black transition hover:brightness-110 disabled:opacity-50"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!error) return null;
  return (
    <div className="mt-4 flex items-start gap-3 rounded-2xl border border-error/20 bg-error/10 p-4 text-sm text-error">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
      <span>{error}</span>
    </div>
  );
}
