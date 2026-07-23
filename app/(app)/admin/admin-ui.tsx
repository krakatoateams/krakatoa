"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";

export type AdminToastType = "loading" | "success" | "error";

export type AdminToastState = {
  type: AdminToastType;
  message: string;
};

export function AdminToast({
  toast,
  onDismiss,
}: {
  toast: AdminToastState;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (toast.type === "loading") return;
    const ms = toast.type === "error" ? 5000 : 2500;
    const t = setTimeout(onDismiss, ms);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  const styles =
    toast.type === "success"
      ? "border-emerald-500/30 bg-gray-900/95 text-emerald-300"
      : toast.type === "error"
        ? "border-red-500/30 bg-gray-900/95 text-red-300"
        : "border-violet-500/30 bg-gray-900/95 text-violet-200";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 right-6 z-50 flex max-w-sm items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-sm ${styles}`}
    >
      {toast.type === "loading" ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
      ) : toast.type === "success" ? (
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
      )}
      <span className="text-sm font-medium">{toast.message}</span>
      {toast.type !== "loading" ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="ml-auto shrink-0 opacity-60 transition-opacity hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function useAdminToast() {
  const [toast, setToast] = useState<AdminToastState | null>(null);
  const dismiss = useCallback(() => setToast(null), []);
  const show = useCallback((next: AdminToastState) => setToast(next), []);
  return { toast, dismiss, show };
}

function Bone({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-800/80 ${className ?? ""}`} />;
}

export function AdminOverviewSkeleton() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <Bone className="h-3 w-16" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Bone key={i} className="h-24" />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Bone key={i} className="h-7 w-24 rounded-full" />
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <Bone className="h-3 w-16" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Bone key={i} className="h-24" />
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <Bone className="h-3 w-36" />
        <Bone className="h-48 w-full rounded-xl" />
      </section>
    </div>
  );
}

export function AdminTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-800">
      <div className="border-b border-gray-800 bg-gray-900/40 px-4 py-3">
        <div className="flex gap-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Bone key={i} className="h-3 w-20" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-gray-800">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 px-4 py-3">
            <Bone className="h-4 w-40" />
            <Bone className="h-4 w-16" />
            <Bone className="h-5 w-14 rounded-full" />
            <Bone className="h-4 w-24" />
            <Bone className="ml-auto h-8 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminUsageSkeleton() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 4 }).map((_, i) => (
        <section key={i} className="space-y-3">
          <Bone className="h-3 w-40" />
          <AdminTableSkeleton rows={i === 0 ? 5 : 4} />
        </section>
      ))}
    </div>
  );
}

export function AdminConfigSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <Bone className="h-4 w-full max-w-xl" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-gray-800/80 p-3">
          <div className="flex items-center gap-3">
            <Bone className="h-4 w-4" />
            <Bone className="h-5 w-28" />
            <Bone className="ml-auto h-4 w-10" />
            <Bone className="h-4 w-14" />
          </div>
          <div className="space-y-2 pl-6">
            <Bone className="h-10 w-full" />
            <Bone className="h-32 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
