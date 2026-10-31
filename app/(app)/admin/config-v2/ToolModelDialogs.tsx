"use client";

import { useEffect, useRef, useState } from "react";
import type { AdminModelNode } from "@/lib/admin-config-tree";
import type { RegistryModel } from "@/lib/model-registry";
import type { ModelImpact } from "@/lib/model-impact";
import { Bone } from "../admin-ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/** The model a dialog acts on, kept while the dialog closes so its content does not blank mid-animation. */
function useLast<T>(value: T | null): T | null {
  const last = useRef<T | null>(null);
  if (value) last.current = value;
  return value ?? last.current;
}

const countText = (n: number | null) => (n === null ? "unknown" : n.toLocaleString("en-US"));
const plural = (n: number | null, one: string, many: string) => `${countText(n)} ${n === 1 ? one : many}`;

/**
 * Remove confirmation for one model in one tool card. Remove archives the model's row for this tool
 * only (the server guard refuses a default, the last model or the last Reels engine). The impact
 * preview loads with a skeleton; a guard refusal is one sentence and keeps the button inert.
 */
export function RemoveModelDialog({
  model,
  toolLabel,
  onConfirm,
  onCancel,
}: {
  model: AdminModelNode | null;
  toolLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const m = useLast(model);
  const [impact, setImpact] = useState<ModelImpact | null>(null);
  const [failed, setFailed] = useState(false);
  const id = model?.catalogConfigId ?? null;

  useEffect(() => {
    // Closing keeps the last preview (no skeleton flash mid-animation); a new model starts fresh.
    if (!id) return;
    setImpact(null);
    setFailed(false);
    let cancelled = false;
    fetch(`/api/admin/config/model-catalog/${id}/impact`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { impact: ModelImpact }) => !cancelled && setImpact(data.impact))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const blocked = impact ? !impact.archiveCheck.ok : false;
  return (
    <ConfirmDialog
      open={model !== null}
      title={m ? `Remove ${m.label} from ${toolLabel}?` : ""}
      description="Past creations keep working and prices are kept. You can add it back later with Add model."
      confirmLabel="Remove"
      confirmDisabled={blocked || (impact === null && !failed)}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {impact && !impact.archiveCheck.ok ? (
        <p role="alert" className="mt-3 text-xs text-amber-300">
          {impact.archiveCheck.reasons[0]}
        </p>
      ) : null}
      <div className="mt-3" aria-busy={impact === null && !failed}>
        {failed ? (
          <p className="text-xs text-gray-400">The details could not be loaded. You can still remove the model.</p>
        ) : impact === null ? (
          <div className="space-y-2" aria-hidden>
            <Bone className="h-3 w-56" />
            <Bone className="h-3 w-44" />
            <Bone className="h-3 w-48" />
          </div>
        ) : (
          <ul className="space-y-1.5 text-xs text-gray-400">
            <li>
              Used in:{" "}
              <span className="text-white">
                {impact.enabledIn.length ? impact.enabledIn.map((f) => f.label).join(", ") : "nothing right now"}
              </span>
              {impact.enabledIn.length > 1 ? " (all of them lose this model)" : null}
            </li>
            {impact.reelsEngine ? (
              <li>
                Runs the <span className="text-white">{impact.reelsEngine}</span> engine in Reels Creator.
              </li>
            ) : null}
            <li>
              Skills that use it:{" "}
              <span className="text-white">
                {impact.skills === null ? "unknown" : impact.skills.length ? impact.skills.join(", ") : "none"}
              </span>
              {impact.skills?.length ? " (they switch to the default model)" : null}
            </li>
            {impact.counts.inFlightJobs ? (
              <li>{plural(impact.counts.inFlightJobs, "creation is", "creations are")} still running; they finish normally.</li>
            ) : null}
            <li>
              Made with it so far: {plural(impact.counts.jobs.allTime, "creation", "creations")} (
              {countText(impact.counts.jobs.last30Days)} in the last 30 days).
            </li>
          </ul>
        )}
      </div>
    </ConfirmDialog>
  );
}

/**
 * "Add model" for one tool card: lists only this tool's models that are not in the card (removed ones).
 * Adding restores the model and turns it on; the server re-runs the same guard (price, provider).
 */
export function AddModelDialog({
  open,
  toolKey,
  toolLabel,
  candidates,
  onAdd,
  onClose,
}: {
  open: boolean;
  toolKey: string;
  toolLabel: string;
  candidates: AdminModelNode[];
  onAdd: (model: AdminModelNode) => void;
  onClose: () => void;
}) {
  const [registry, setRegistry] = useState<RegistryModel[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setRegistry(null);
    let cancelled = false;
    // Guard results and provider names come fresh from the server; a failed read still lists the models.
    fetch("/api/admin/config/model-registry")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { models: RegistryModel[] }) => !cancelled && setRegistry(data.models))
      .catch(() => !cancelled && setRegistry([]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const info = (m: AdminModelNode) => registry?.find((r) => r.toolKey === toolKey && r.modelId === m.id);
  const reasonFor = (m: AdminModelNode) => {
    const check = info(m)?.addCheck;
    if (!check || check.ok) return null;
    if (check.code === "PRICING_NOT_READY") return "Needs a price before it can be added.";
    return check.reasons[0] ?? "This model cannot be added yet.";
  };
  const choice = candidates.find((m) => m.id === selected) ?? null;

  return (
    <ConfirmDialog
      open={open}
      title={`Add a model to ${toolLabel}`}
      confirmLabel="Add model"
      confirmVariant="primary"
      confirmDisabled={!choice || registry === null || reasonFor(choice) !== null}
      onConfirm={() => choice && onAdd(choice)}
      onCancel={onClose}
    >
      <div className="mt-3" aria-busy={registry === null}>
        {candidates.length === 0 ? (
          <p className="text-sm text-gray-400">
            Every model for this tool is already in the list. New models are added by a developer and show up
            in the list switched off.
          </p>
        ) : registry === null ? (
          <div className="space-y-2" aria-hidden>
            {candidates.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg border border-white/10 px-3 py-2.5">
                <Bone className="h-4 w-4 rounded-full" />
                <div className="space-y-1.5">
                  <Bone className="h-3.5 w-32" />
                  <Bone className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto" role="radiogroup" aria-label="Models you can add">
            {candidates.map((m) => {
              const reason = reasonFor(m);
              const active = selected === m.id;
              return (
                <li key={m.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                      active ? "border-white/30 bg-white/[0.06]" : "border-white/10 hover:border-white/20"
                    } ${reason ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <input
                      type="radio"
                      name={`add-model-${toolKey}`}
                      className="mt-0.5"
                      checked={active}
                      disabled={reason !== null}
                      onChange={() => setSelected(m.id)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-white">{m.label}</span>
                      <span className="block text-xs text-gray-500">{info(m)?.provider.label ?? m.subtitle}</span>
                      {reason ? <span className="mt-0.5 block text-xs text-amber-300/90">{reason}</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ConfirmDialog>
  );
}
