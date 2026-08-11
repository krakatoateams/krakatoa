"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";

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

/** Uppercase label that opens each block on the admin Overview. */
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
      {children}
    </h2>
  );
}

/** Single metric tile. */
export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-gray-500">{sub}</p> : null}
    </div>
  );
}

export type AdminColumn<T> = {
  key: string;
  header: string;
  /** Right-align numeric columns. */
  align?: "left" | "right";
  render: (row: T) => ReactNode;
};

/**
 * Read-only admin table. Wraps the markup that was previously hand-copied
 * across every admin page so the seven Analytics tables stay consistent.
 */
export function AdminTable<T>({
  columns,
  rows,
  rowKey,
  empty = "No data yet.",
}: {
  columns: AdminColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  empty?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/30 px-4 py-6 text-sm text-gray-500">
        {empty}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-900/60 text-[11px] uppercase tracking-wider text-gray-500">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`whitespace-nowrap px-4 py-2.5 font-semibold ${
                  col.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="text-gray-300">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`whitespace-nowrap px-4 py-2.5 ${
                    col.align === "right"
                      ? "text-right tabular-nums"
                      : "text-left"
                  }`}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "X-Y of N" plus prev/next. Hidden entirely when everything fits on one page. */
export function AdminPagination({
  page,
  pageSize,
  total,
  onPageChange,
  busy = false,
}: {
  /** 1-based. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  busy?: boolean;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const btn =
    "inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-800 text-gray-400 transition-colors hover:border-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="mt-2 flex items-center justify-between px-1">
      <p className="text-xs text-gray-500">
        {first}-{last} of {total}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={busy || page <= 1}
          aria-label="Previous page"
          className={btn}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-1 text-xs tabular-nums text-gray-500">
          {page} / {lastPage}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={busy || page >= lastPage}
          aria-label="Next page"
          className={btn}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
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
