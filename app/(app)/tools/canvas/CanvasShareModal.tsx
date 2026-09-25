"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Trash2, UserPlus, X } from "lucide-react";
import type { CanvasCollaborator, CanvasCollaboratorRole } from "@/lib/canvas-document";

export default function CanvasShareModal({
  open,
  canvasId,
  canvasTitle,
  onClose,
}: {
  open: boolean;
  canvasId: string;
  canvasTitle: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CanvasCollaboratorRole>("editor");
  const [collaborators, setCollaborators] = useState<CanvasCollaborator[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/canvas/${canvasId}/collaborators`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        collaborators?: CanvasCollaborator[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Failed to load collaborators.");
      setCollaborators(data.collaborators ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load collaborators.");
    } finally {
      setLoading(false);
    }
  }, [canvasId]);

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setRole("editor");
    setError(null);
    void load();
  }, [load, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  const handleInvite = async () => {
    const nextEmail = email.trim();
    if (!nextEmail) return;
    setInviting(true);
    setError(null);
    try {
      const res = await fetch(`/api/canvas/${canvasId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: nextEmail, role }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        collaborator?: CanvasCollaborator;
        error?: string;
      };
      if (!res.ok || !data.collaborator) {
        throw new Error(data.error || "Failed to send invite.");
      }
      setCollaborators((current) => {
        const without = current.filter((item) => item.id !== data.collaborator!.id);
        return [...without, data.collaborator!].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt)
        );
      });
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invite.");
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (collaboratorId: string) => {
    setRemovingId(collaboratorId);
    setError(null);
    try {
      const res = await fetch(`/api/canvas/${canvasId}/collaborators/${collaboratorId}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to remove collaborator.");
      setCollaborators((current) => current.filter((item) => item.id !== collaboratorId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove collaborator.");
    } finally {
      setRemovingId(null);
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close share dialog"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-share-title"
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-N50 p-5 shadow-2xl shadow-black/50"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="canvas-share-title" className="text-base font-semibold text-text-primary">
              Share canvas
            </h2>
            <p className="mt-0.5 truncate text-sm text-text-secondary">{canvasTitle}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg p-1.5 text-icon-low-emphasis transition-colors hover:bg-white/10 hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleInvite();
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@email.com"
              autoComplete="email"
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-white/25"
            />
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as CanvasCollaboratorRole)}
              aria-label="Access level"
              className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-text-primary outline-none focus:border-white/25"
            >
              <option value="editor">Can edit</option>
              <option value="viewer">Can view</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={inviting || !email.trim()}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-3 text-sm font-semibold text-text-primary transition-colors hover:bg-white/15 disabled:opacity-50"
          >
            {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Invite by email
          </button>
        </form>

        <p className="mt-3 text-xs text-text-secondary">
          They&apos;ll see this canvas after signing in with that email address.
        </p>

        {error ? <p className="mt-3 text-sm text-error">{error}</p> : null}

        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-secondary">
            People with access
          </p>
          {loading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : collaborators.length === 0 ? (
            <p className="text-sm text-text-secondary">No collaborators yet.</p>
          ) : (
            <ul className="space-y-2">
              {collaborators.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">{item.invitedEmail}</p>
                    <p className="text-xs text-text-secondary">
                      {item.role === "editor" ? "Can edit" : "Can view"}
                      {item.status === "pending" ? " · Pending" : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${item.invitedEmail}`}
                    disabled={removingId === item.id}
                    onClick={() => void handleRemove(item.id)}
                    className="rounded-lg p-1.5 text-icon-low-emphasis transition-colors hover:bg-white/10 hover:text-error disabled:opacity-50"
                  >
                    {removingId === item.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
