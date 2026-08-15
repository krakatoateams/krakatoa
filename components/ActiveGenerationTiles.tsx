"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { GENERATION_CHANGED_EVENT } from "@/lib/active-generation-events";
import type { ActiveGeneration } from "@/lib/active-generations-pure";
import { isLiveStatus } from "@/lib/active-generations-pure";

function emitChanged() {
  window.dispatchEvent(new Event(GENERATION_CHANGED_EVENT));
}

function actionErrorMessage(data: Record<string, unknown>, status: number): string {
  if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
  if (typeof data.message === "string" && data.message.trim()) return data.message.trim();
  return `Request failed (${status})`;
}

async function postAction(
  url: string,
  body: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: actionErrorMessage(data, res.status) };
    return { ok: true };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

/** In-progress tiles meant to sit in the same grid as finished history cards. */
export function ActiveGenerationTiles({
  items,
  tileClassName = "rounded-2xl border border-brand-primary/30",
}: {
  items: ActiveGeneration[];
  tileClassName?: string;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const cancelJob = async (item: ActiveGeneration) => {
    if (!item.idempotencyKey) return;
    setBusyId(item.jobId);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[item.jobId];
      return next;
    });
    const result = await postAction("/api/generations/cancel", {
      idempotencyKey: item.idempotencyKey,
    });
    setBusyId(null);
    if (!result.ok) {
      setErrors((prev) => ({ ...prev, [item.jobId]: result.error }));
      return;
    }
    emitChanged();
  };

  const resumeJob = async (item: ActiveGeneration) => {
    setBusyId(item.jobId);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[item.jobId];
      return next;
    });
    const result = await postAction("/api/generations/resume", { jobId: item.jobId });
    setBusyId(null);
    if (!result.ok) {
      setErrors((prev) => ({ ...prev, [item.jobId]: result.error }));
      return;
    }
    emitChanged();
  };

  if (items.length === 0) return null;

  return (
    <>
      {items.map((item) => {
        const live = isLiveStatus(item.status);
        const busy = busyId === item.jobId;
        const actionError = errors[item.jobId];
        const statusCopy =
          item.status === "queued"
            ? "Queued…"
            : item.status === "running"
              ? item.phase
                ? `Generating · ${item.phase}`
                : "Generating…"
              : item.status === "recoverable"
                ? "Paused — try again"
                : item.errorMessage || "Generation failed";

        return (
          <div key={item.jobId} className={`overflow-hidden ${tileClassName}`}>
            <div className="relative flex aspect-square w-full flex-col items-center justify-center bg-white/[0.04]">
              {live && <div className="absolute inset-0 animate-pulse bg-white/[0.04]" />}
              <Loader2
                className={`relative h-7 w-7 ${
                  live ? "animate-spin text-brand-primary" : "text-amber-400/80"
                }`}
              />
              <p className="relative mt-3 px-3 text-center text-xs font-medium text-white">
                {item.label}
              </p>
              <p className="relative mt-1 max-w-[90%] truncate px-3 text-center text-[11px] text-gray-400">
                {statusCopy}
              </p>
              {actionError && (
                <p className="relative mt-1 max-w-[90%] px-3 text-center text-[11px] text-amber-300">
                  {actionError}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-2.5">
              <Link href={item.href} className="text-xs text-gray-400 hover:text-white">
                Open tool
              </Link>
              {live && item.idempotencyKey && item.cancelAllowed && (
                <button
                  type="button"
                  onClick={() => void cancelJob(item)}
                  disabled={busy}
                  className="text-xs text-gray-400 hover:text-white disabled:opacity-50"
                >
                  {busy ? "Cancelling" : "Cancel"}
                </button>
              )}
              {item.status === "recoverable" && (
                <button
                  type="button"
                  onClick={() => void resumeJob(item)}
                  disabled={busy}
                  className="text-xs text-brand-primary hover:text-white disabled:opacity-50"
                >
                  {busy ? "Retrying" : "Try again"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
