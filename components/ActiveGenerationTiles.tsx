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
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: actionErrorMessage(data, res.status) };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

const touchActionClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-xs disabled:opacity-50";

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
  const [notices, setNotices] = useState<Record<string, string>>({});

  const clearFeedback = (jobId: string) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
    setNotices((prev) => {
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
  };

  const stopJob = async (item: ActiveGeneration) => {
    if (
      !item.refundEligible &&
      !window.confirm(
        "The provider has already completed billable work. Stop and remove remaining artifacts without a credit refund?",
      )
    ) {
      return;
    }

    setBusyId(item.jobId);
    clearFeedback(item.jobId);

    const useJobStop =
      item.executionBackend === "workflow" ||
      item.isStale ||
      !item.cancelAllowed ||
      !item.idempotencyKey;

    const result = await postAction(
      "/api/generations/cancel",
      useJobStop ? { jobId: item.jobId } : { idempotencyKey: item.idempotencyKey! },
    );
    setBusyId(null);
    if (!result.ok) {
      setErrors((prev) => ({ ...prev, [item.jobId]: result.error }));
      return;
    }

    const refundEligibleNow = result.data.refundEligible !== false;
    if (!refundEligibleNow) {
      setNotices((prev) => ({
        ...prev,
        [item.jobId]: "Stopping — credits will not be refunded because generation already committed.",
      }));
    } else if (result.data.status === "stopping") {
      setNotices((prev) => ({
        ...prev,
        [item.jobId]: "Stopping — eligible credits will be refunded.",
      }));
    }

    emitChanged();
  };

  const resumeJob = async (item: ActiveGeneration) => {
    setBusyId(item.jobId);
    clearFeedback(item.jobId);
    const result = await postAction("/api/generations/resume", { jobId: item.jobId });
    setBusyId(null);
    if (!result.ok) {
      setErrors((prev) => ({ ...prev, [item.jobId]: result.error }));
      return;
    }
    emitChanged();
  };

  const dismissJob = async (item: ActiveGeneration) => {
    setBusyId(item.jobId);
    clearFeedback(item.jobId);
    const result = await postAction("/api/generations/dismiss", { jobId: item.jobId });
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
        const actionNotice = notices[item.jobId];
        const statusCopy =
          item.status === "queued"
            ? "Queued…"
            : item.status === "running"
              ? item.phase
                ? `Generating · ${item.phase}`
                : "Generating…"
              : item.status === "recoverable"
                ? "Paused — try again"
                : item.status === "cancelled"
                  ? item.errorMessage || "Generation stopped"
                  : item.errorMessage || "Generation failed";

        return (
          <div key={item.jobId} className={`overflow-hidden ${tileClassName}`}>
            <div className="relative flex aspect-square w-full flex-col items-center justify-center bg-white/[0.04]">
              {live && <div className="absolute inset-0 animate-pulse bg-white/[0.04]" />}
              <Loader2
                className={`relative h-7 w-7 ${
                  live ? "animate-spin text-brand-primary" : "text-warning/80"
                }`}
              />
              <p className="relative mt-3 px-3 text-center text-xs font-medium text-N900">
                {item.label}
              </p>
              <p className="relative mt-1 max-w-[90%] truncate px-3 text-center text-[11px] text-text-secondary">
                {statusCopy}
              </p>
              {item.isStale && live && (
                <p className="relative mt-1 max-w-[90%] px-3 text-center text-[11px] text-warning/90">
                  May be stuck — you can stop it.
                </p>
              )}
              {actionNotice && (
                <p className="relative mt-1 max-w-[90%] px-3 text-center text-[11px] text-text-secondary">
                  {actionNotice}
                </p>
              )}
              {actionError && (
                <p className="relative mt-1 max-w-[90%] px-3 text-center text-[11px] text-warning">
                  {actionError}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <Link href={item.href} className="text-xs text-text-secondary hover:text-N900">
                Open tool
              </Link>
              <div className="flex flex-wrap items-center justify-end gap-1">
                {item.canStop && (
                  <button
                    type="button"
                    onClick={() => void stopJob(item)}
                    disabled={busy}
                    className={`${touchActionClass} text-text-secondary hover:text-N900`}
                    aria-label={
                      item.refundEligible
                        ? `Stop ${item.label}`
                        : `Stop ${item.label} without refund`
                    }
                  >
                    {busy ? "Stopping" : "Stop"}
                  </button>
                )}
                {item.canRetry && (
                  <button
                    type="button"
                    onClick={() => void resumeJob(item)}
                    disabled={busy}
                    className={`${touchActionClass} text-brand-primary hover:text-N900`}
                    aria-label={`Try again ${item.label}`}
                  >
                    {busy ? "Retrying" : "Try again"}
                  </button>
                )}
                {item.canDismiss && (
                  <button
                    type="button"
                    onClick={() => void dismissJob(item)}
                    disabled={busy}
                    className={`${touchActionClass} text-text-secondary hover:text-N900`}
                    aria-label={`Remove ${item.label} from list`}
                  >
                    {busy ? "Removing" : "Remove"}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
