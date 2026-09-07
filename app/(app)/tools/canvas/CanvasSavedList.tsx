"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderKanban, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import type { CanvasSummary } from "@/lib/canvas-document";

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CanvasSavedList({
  open,
  activeId,
  onClose,
  onSelect,
  onNew,
  onDeleted,
  onRenamed,
}: {
  open: boolean;
  activeId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDeleted?: (id: string) => void;
  onRenamed?: (id: string, title: string) => void;
}) {
  const [items, setItems] = useState<CanvasSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const skipRenameBlur = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/canvas");
      const data = (await res.json().catch(() => ({}))) as {
        canvases?: CanvasSummary[];
        error?: string;
      };
      if (res.status === 401) {
        setError("Sign in to see saved canvases.");
        setItems([]);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Failed to load canvases.");
      setItems(data.canvases ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load canvases.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  useEffect(() => {
    if (open) return;
    setRenamingId(null);
    setRenameValue("");
    setRenameSaving(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (renamingId) {
        event.preventDefault();
        setRenamingId(null);
        setRenameValue("");
        setRenameSaving(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open, renamingId]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this canvas? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/canvas/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to delete.");
      }
                    setItems((current) => current.filter((item) => item.id !== id));
                    onDeleted?.(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setDeletingId(null);
    }
  };

  const beginRename = (item: CanvasSummary) => {
    setRenamingId(item.id);
    setRenameValue(item.title);
    setError(null);
  };

  const cancelRename = () => {
    skipRenameBlur.current = true;
    setRenamingId(null);
    setRenameValue("");
    setRenameSaving(false);
  };

  const commitRename = async () => {
    if (!renamingId || renameSaving) return;
    const id = renamingId;
    const current = items.find((item) => item.id === id);
    const nextTitle = renameValue.trim();
    if (!current || nextTitle === current.title.trim()) {
      setRenamingId((active) => (active === id ? null : active));
      if (id === renamingId) setRenameValue("");
      return;
    }
    setRenameSaving(true);
    try {
      const res = await fetch(`/api/canvas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: renameValue }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        canvas?: { id: string; title: string };
        error?: string;
      };
      if (!res.ok || !data.canvas) {
        throw new Error(data.error || "Failed to rename.");
      }
      setItems((list) =>
        list.map((item) =>
          item.id === data.canvas!.id ? { ...item, title: data.canvas!.title } : item
        )
      );
      onRenamed?.(data.canvas.id, data.canvas.title);
      setRenamingId((active) => (active === id ? null : active));
      setRenameValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename.");
    } finally {
      setRenameSaving(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/55 backdrop-blur-sm">
      <button type="button" aria-label="Close saved canvases" className="absolute inset-0 cursor-default" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-saved-title"
        className="relative flex h-full w-full max-w-md flex-col border-l border-white/10 bg-N50 shadow-2xl shadow-black/50"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <FolderKanban className="h-4 w-4 shrink-0 text-text-secondary" />
            <h2 id="canvas-saved-title" className="truncate text-sm font-semibold text-text-primary">
              Saved canvases
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onNew}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
            <button
              type="button"
              aria-label="Close saved canvases"
              onClick={onClose}
              className="rounded-lg p-1.5 text-icon-low-emphasis transition-colors hover:bg-white/10 hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading canvases…
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-text-secondary">
              {error ?? "No saved canvases yet. Add nodes, then Save."}
            </p>
          ) : (
            <>
              {error ? <p className="mb-3 text-sm text-error">{error}</p> : null}
              <ul className="space-y-2">
              {items.map((item) => {
                const active = item.id === activeId;
                return (
                  <li key={item.id}>
                    <div
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${
                        active
                          ? "border-white/25 bg-white/10"
                          : "border-white/10 bg-white/[0.03] hover:border-white/20"
                      }`}
                    >
                      {renamingId === item.id ? (
                        <div className="min-w-0 flex-1">
                          <input
                            autoFocus
                            value={renameValue}
                            disabled={renameSaving}
                            maxLength={80}
                            aria-label={`Rename ${item.title}`}
                            onChange={(event) => setRenameValue(event.target.value)}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void commitRename();
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                cancelRename();
                              }
                            }}
                            onBlur={() => {
                              if (skipRenameBlur.current) {
                                skipRenameBlur.current = false;
                                return;
                              }
                              void commitRename();
                            }}
                            className="w-full rounded-md border border-white/15 bg-white/[0.06] px-1.5 py-0.5 text-sm font-medium text-text-primary outline-none focus:border-white/30"
                          />
                          <p className="mt-0.5 text-xs text-text-secondary">
                            {item.nodeCount} {item.nodeCount === 1 ? "node" : "nodes"}
                            {item.updatedAt ? ` · ${formatUpdated(item.updatedAt)}` : ""}
                          </p>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelect(item.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-sm font-medium text-text-primary">{item.title}</p>
                          <p className="mt-0.5 text-xs text-text-secondary">
                            {item.nodeCount} {item.nodeCount === 1 ? "node" : "nodes"}
                            {item.updatedAt ? ` · ${formatUpdated(item.updatedAt)}` : ""}
                          </p>
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Rename ${item.title}`}
                        disabled={Boolean(deletingId) || renameSaving}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (renamingId === item.id) {
                            void commitRename();
                            return;
                          }
                          beginRename(item);
                        }}
                        className="rounded-lg p-1.5 text-icon-low-emphasis transition-colors hover:bg-white/10 hover:text-text-primary disabled:opacity-50"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${item.title}`}
                        disabled={deletingId === item.id}
                        onClick={() => void handleDelete(item.id)}
                        className="rounded-lg p-1.5 text-icon-low-emphasis transition-colors hover:bg-white/10 hover:text-error disabled:opacity-50"
                      >
                        {deletingId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}
