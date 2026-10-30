"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RegistryModel } from "@/lib/model-registry";
import type { ModelImpact } from "@/lib/model-impact";
import { Bone } from "../admin-ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const TOOL_LABEL: Record<RegistryModel["toolKey"], string> = { photo: "Photo", reels: "Video" };

type Tone = "ok" | "off" | "warn";
const TONE: Record<Tone, string> = {
  ok: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  off: "border-white/10 bg-white/[0.03] text-gray-400",
  warn: "border-amber-400/30 bg-amber-400/10 text-amber-300",
};

function Badge({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] ${TONE[tone]}`}>
      {children}
    </span>
  );
}


const STALE_MESSAGE = "Someone else changed this model. Review and try again.";
const MIGRATION_HINT = "Run migration 118 to enable archiving";

/** Same fact as the server guard: the provider is not configured. Requests fall back to Replicate until it is. */
function providerText(m: RegistryModel): string {
  return m.provider.configured ? m.provider.label : `${m.provider.label} (not configured, requests use Replicate)`;
}

function ModelRow({
  m,
  busy,
  notice,
  onToggle,
  onAdd,
  onRemove,
  archiveAvailable,
}: {
  m: RegistryModel;
  busy: boolean;
  notice: string[] | undefined;
  onToggle: (m: RegistryModel, enabled: boolean) => void;
  onAdd: (m: RegistryModel) => void;
  onRemove: (m: RegistryModel) => void;
  archiveAvailable: boolean;
}) {
  const removeReason = !archiveAvailable
    ? MIGRATION_HINT
    : !m.archiveCheck.ok
      ? m.archiveCheck.reasons.join(" ")
      : !m.catalogConfigId || !m.updatedAt
        ? "Model settings are not ready. Refresh and try again."
        : "";
  const missing = m.pricing.keys.filter((k) => !k.ready).map((k) => k.key);
  const check = m.enabled ? m.disableCheck : m.enableCheck;
  const blockedReason = !check.ok ? check.reasons.join(" ") : !m.catalogConfigId || !m.updatedAt ? "Model settings are not ready. Refresh and try again." : "";
  const disabled = busy || blockedReason !== "";
  const noteId = `model-note-${m.toolKey}-${m.modelId}`;
  return (
    <li className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm text-white">{m.label}</p>
        <p className="truncate text-xs text-gray-500">
          {m.modelId} · {providerText(m)}
          {m.enabledIn.length > 0 ? ` · Offered in ${m.enabledIn.map((f) => f.label).join(", ")}` : ""}
        </p>
        {!m.enabled && !m.enableCheck.ok ? (
          <p className="mt-0.5 text-xs text-amber-300/80">Cannot be offered yet: {m.enableCheck.reasons.join(" ")}</p>
        ) : null}
        {m.enabled && !m.disableCheck.ok ? (
          <p className="mt-0.5 text-xs text-gray-500">Cannot be hidden: {m.disableCheck.reasons.join(" ")}</p>
        ) : null}
        <p id={noteId} aria-live="polite" className={notice ? "mt-0.5 text-xs text-amber-300/90" : "sr-only"}>
          {notice ? notice.join(" ") : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
        <Badge tone={m.enabled ? "ok" : "off"}>{m.enabled ? "Offered" : "Not offered"}</Badge>
        {m.enabled && m.enabledIn.length === 0 ? <Badge tone="warn">Hidden in every feature</Badge> : null}
        {m.defaultIn.length > 0 ? <Badge tone="ok">Default for {m.defaultIn.map((f) => f.label).join(", ")}</Badge> : null}
        {m.reelsEngine ? <Badge tone="off">Used by Reels Creator engine</Badge> : null}
        {!m.pricing.ready ? (
          <Badge tone="warn" title={missing.join(", ")}>
            Pricing not ready: {missing.length} {missing.length === 1 ? "key" : "keys"}
          </Badge>
        ) : null}
        {!m.provider.configured ? <Badge tone="warn">Provider not configured</Badge> : null}
        {m.availableToAdd ? <Badge tone="off">Available to add</Badge> : null}
        {!m.enabled ? (
          <button
            type="button"
            disabled={busy || !m.catalogConfigId || !m.updatedAt}
            onClick={() => onAdd(m)}
            aria-label={`Add ${m.label}`}
            className="rounded border border-white/15 px-2 py-0.5 text-xs text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add…
          </button>
        ) : null}
        <button
          type="button"
          role="switch"
          aria-checked={m.enabled}
          aria-label={`${m.enabled ? "Hide" : "Offer"} ${m.label}`}
          aria-describedby={noteId}
          disabled={disabled}
          title={blockedReason || (m.enabled ? "Hide this model from users" : "Offer this model to users")}
          onClick={() => onToggle(m, !m.enabled)}
          className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            m.enabled ? "border-emerald-400/40 bg-emerald-400/30" : "border-white/15 bg-white/10"
          }`}
        >
          <span
            className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all ${m.enabled ? "left-[18px]" : "left-0.5"}`}
          />
        </button>
        <button
          type="button"
          disabled={busy || removeReason !== ""}
          onClick={() => onRemove(m)}
          aria-label={`Remove ${m.label}`}
          title={removeReason || "Remove this model. You can restore it later."}
          className="rounded border border-white/15 px-2 py-0.5 text-xs text-gray-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Remove…
        </button>
        {busy ? <span className="text-[11px] text-gray-400">Saving…</span> : null}
      </div>
    </li>
  );
}

function RemovedRow({ m, busy, notice, archiveAvailable, onRestore }: {
  m: RegistryModel;
  busy: boolean;
  notice: string[] | undefined;
  archiveAvailable: boolean;
  onRestore: (m: RegistryModel) => void;
}) {
  const disabled = busy || !archiveAvailable || !m.catalogConfigId || !m.updatedAt;
  return (
    <li className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm text-gray-300">{m.label}</p>
        <p className="truncate text-xs text-gray-500">
          {m.modelId} · Removed. Past creations still show this model. Prices are kept.
        </p>
        {notice ? <p aria-live="polite" className="mt-0.5 text-xs text-amber-300/90">{notice.join(" ")}</p> : null}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onRestore(m)}
          aria-label={`Restore ${m.label}`}
          title={!archiveAvailable ? MIGRATION_HINT : "Restore this model. It stays not offered until you add it again."}
          className="rounded border border-white/15 px-2 py-0.5 text-xs text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Restore
        </button>
        {busy ? <span className="text-[11px] text-gray-400">Saving…</span> : null}
      </div>
    </li>
  );
}

const countText = (n: number | null) => (n === null ? "unknown" : n.toLocaleString("en-US"));

/** Remove confirmation: impact preview (skeleton while loading), guard reasons, and the plain reassurance. */
function RemoveModelDialog({ model, archiveAvailable, onConfirm, onCancel }: {
  model: RegistryModel | null;
  archiveAvailable: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const last = useRef<RegistryModel | null>(null);
  if (model) last.current = model;
  const m = model ?? last.current;
  const [impact, setImpact] = useState<ModelImpact | null>(null);
  const [failed, setFailed] = useState(false);
  const id = model?.catalogConfigId ?? null;

  useEffect(() => {
    setImpact(null);
    setFailed(false);
    if (!id) return;
    let cancelled = false;
    fetch(`/api/admin/config/model-catalog/${id}/impact`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { impact: ModelImpact }) => !cancelled && setImpact(data.impact))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const check = impact?.archiveCheck ?? m?.archiveCheck;
  const blocked = !archiveAvailable || (check ? !check.ok : false);
  const c = impact?.counts;
  return (
    <ConfirmDialog
      open={model !== null}
      title={m ? `Remove ${m.label}?` : ""}
      description="Past creations keep working. Prices are kept. You can restore this model later."
      confirmLabel="Remove model"
      confirmDisabled={blocked || (impact === null && !failed)}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {!archiveAvailable ? (
        <p role="alert" className="mt-3 text-xs text-amber-300">{MIGRATION_HINT}</p>
      ) : check && !check.ok ? (
        <div role="alert" className="mt-3 rounded border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-300">
          Cannot be removed yet: {check.reasons.join(" ")}
        </div>
      ) : null}
      <div className="mt-3" aria-busy={impact === null && !failed}>
        {failed ? (
          <p className="text-xs text-gray-400">The impact preview could not be loaded. You can still remove the model.</p>
        ) : impact === null ? (
          <div className="space-y-2" aria-hidden>
            <Bone className="h-3 w-48" />
            <Bone className="h-3 w-64" />
            <Bone className="h-3 w-40" />
          </div>
        ) : (
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="text-gray-500">Still running now</dt>
              <dd className="text-white">{countText(c!.inFlightJobs)} {c!.inFlightJobs === 1 ? "creation" : "creations"} (they finish normally)</dd>
            </div>
            <div>
              <dt className="text-gray-500">Past creations (last 30 days / all time)</dt>
              <dd className="text-white">
                Jobs {countText(c!.jobs.last30Days)} / {countText(c!.jobs.allTime)} · Assets {countText(c!.assets.last30Days)} /{" "}
                {countText(c!.assets.allTime)} · Usage events {countText(c!.usageEvents.last30Days)} / {countText(c!.usageEvents.allTime)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Offered in</dt>
              <dd className="text-white">{impact.enabledIn.length ? impact.enabledIn.map((f) => f.label).join(", ") : "Nowhere"}</dd>
            </div>
            {impact.defaultIn.length > 0 ? (
              <div>
                <dt className="text-gray-500">Default for</dt>
                <dd className="text-white">{impact.defaultIn.map((f) => f.label).join(", ")}</dd>
              </div>
            ) : null}
            {impact.reelsEngine ? (
              <div>
                <dt className="text-gray-500">Reels Creator</dt>
                <dd className="text-white">Runs the {impact.reelsEngine} engine</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-gray-500">Skills that use it</dt>
              <dd className="text-white">{impact.skills === null ? "unknown" : impact.skills.length ? impact.skills.join(", ") : "None"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Prices kept</dt>
              <dd className="text-white">{impact.pricingKeys.length ? impact.pricingKeys.join(", ") : "No price keys"}</dd>
            </div>
          </dl>
        )}
      </div>
    </ConfirmDialog>
  );
}

/** Read-only summary of what adding a model does, with the server guard result. No inputs. */
function AddModelDialog({ model, onConfirm, onCancel }: { model: RegistryModel | null; onConfirm: () => void; onCancel: () => void }) {
  // Keep the last model while the dialog closes so its content does not blank mid-animation.
  const last = useRef<RegistryModel | null>(null);
  if (model) last.current = model;
  const m = model ?? last.current;
  const blocked = m ? !m.enableCheck.ok : false;
  return (
    <ConfirmDialog
      open={model !== null}
      title={m ? `Add ${m.label}?` : ""}
      description="Users will see this model in the places listed below. It applies to new requests right away."
      confirmLabel="Add model"
      confirmVariant="primary"
      confirmDisabled={blocked}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {m ? (
        <dl className="mt-3 space-y-2 text-xs">
          <div>
            <dt className="text-gray-500">Tool</dt>
            <dd className="text-white">{TOOL_LABEL[m.toolKey]}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Will appear in</dt>
            <dd className="text-white">
              {m.willAppearIn.length > 0 ? m.willAppearIn.map((f) => f.label).join(", ") : "No feature (all eligible features have it turned off)"}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Price (credits)</dt>
            <dd className="text-white">
              {m.pricing.keys.length === 0
                ? "No price keys"
                : m.pricing.keys.map((k) => `${k.key}: ${k.ready && k.credits !== null ? k.credits : "not set"}`).join(" · ")}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Provider</dt>
            <dd className="text-white">
              {providerText(m)} · {m.provider.configured ? "configured" : "not configured"}
            </dd>
          </div>
        </dl>
      ) : null}
      {m ? (
        blocked ? (
          <div role="alert" className="mt-3 rounded border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-300">
            <p>Cannot be added yet: {m.enableCheck.reasons.join(" ")}</p>
            {m.enableCheck.code === "PRICING_NOT_READY" ? (
              <a href="#admin-config-tools" onClick={onCancel} className="mt-1 inline-block underline">
                Go to Pricing
              </a>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-xs text-emerald-300">All checks passed.</p>
        )
      ) : null}
    </ConfirmDialog>
  );
}

function RegistrySkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <div className="space-y-1.5">
            <Bone className="h-4 w-40" />
            <Bone className="h-3 w-64" />
          </div>
          <Bone className="h-5 w-24" />
        </div>
      ))}
    </div>
  );
}

/** Status and guarded on/off of every code-catalog generation model. */
export function ModelRegistrySection({ refreshKey = 0, onChanged }: { refreshKey?: number; onChanged?: () => void }) {
  const [models, setModels] = useState<RegistryModel[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [notices, setNotices] = useState<Record<string, string[]>>({});
  const [confirm, setConfirm] = useState<RegistryModel | null>(null);
  const [adding, setAdding] = useState<RegistryModel | null>(null);
  const [removing, setRemoving] = useState<RegistryModel | null>(null);
  const [archiveAvailable, setArchiveAvailable] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/config/model-registry");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { models: RegistryModel[]; notes?: string[]; archiveAvailable?: boolean };
      setModels(data.models);
      setNotes(data.notes ?? []);
      setArchiveAvailable(data.archiveAvailable === true);
    } catch {
      setError("Could not load the model list.");
      setModels((prev) => prev ?? []);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const keyOf = (m: RegistryModel) => `${m.toolKey}:${m.modelId}`;
  const setNotice = (m: RegistryModel, reasons: string[] | null) =>
    setNotices((prev) => {
      const next = { ...prev };
      if (reasons) next[keyOf(m)] = reasons;
      else delete next[keyOf(m)];
      return next;
    });

  // Optimistic: flip the row now, roll back to the server's row on any failure.
  const apply = async (m: RegistryModel, enabled: boolean) => {
    const key = keyOf(m);
    if (saving.has(key) || !m.catalogConfigId || !m.updatedAt) return;
    setNotice(m, null);
    setSaving((prev) => new Set(prev).add(key));
    setModels((prev) => prev?.map((x) => (keyOf(x) === key ? { ...x, enabled } : x)) ?? prev);
    let ok = false;
    try {
      const res = await fetch(`/api/admin/config/model-catalog/${m.catalogConfigId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, expectedUpdatedAt: m.updatedAt }),
      });
      const data = (await res.json().catch(() => ({}))) as { code?: string; reasons?: string[]; error?: string };
      if (res.ok) ok = true;
      else if (data.code === "STALE_MODEL_CONFIG") setNotice(m, [STALE_MESSAGE]);
      else setNotice(m, data.reasons?.length ? data.reasons : [data.error ?? "Could not save the change."]);
    } catch {
      setNotice(m, ["Could not save the change. Check your connection and try again."]);
    }
    setSaving((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    // Success or not, the server is the truth: reload fixes the rollback, new tokens and guard checks.
    await load();
    if (ok) onChanged?.();
  };

  // Remove / Restore: server-guarded, then reload (the server is the truth).
  const archive = async (m: RegistryModel, kind: "archive" | "restore") => {
    const key = keyOf(m);
    if (saving.has(key) || !m.catalogConfigId || !m.updatedAt) return;
    setNotice(m, null);
    setSaving((prev) => new Set(prev).add(key));
    let ok = false;
    try {
      const res = await fetch(`/api/admin/config/model-catalog/${m.catalogConfigId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: m.updatedAt }),
      });
      const data = (await res.json().catch(() => ({}))) as { code?: string; reasons?: string[]; error?: string };
      if (res.ok) ok = true;
      else if (data.code === "STALE_MODEL_CONFIG") setNotice(m, [STALE_MESSAGE]);
      else if (data.code === "MIGRATION_REQUIRED") setNotice(m, [MIGRATION_HINT]);
      else setNotice(m, data.reasons?.length ? data.reasons : [data.error ?? "Could not save the change."]);
    } catch {
      setNotice(m, ["Could not save the change. Check your connection and try again."]);
    }
    setSaving((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    await load();
    if (ok) onChanged?.();
  };

  const onToggle = (m: RegistryModel, enabled: boolean) => {
    if (enabled) void apply(m, true);
    else setConfirm(m);
  };

  return (
    <section className="rounded-lg border border-white/10 p-3" aria-labelledby="model-registry-title">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 id="model-registry-title" className="text-sm font-semibold text-white">
            Models
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Turn a model on or off for users. Changes apply to new requests right away; jobs already
            running are not affected. Defaults and pricing are changed in the tool cards below.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          aria-busy={refreshing}
          className="text-xs text-gray-300 hover:text-white disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {error}
        </p>
      ) : null}
      {notes.map((n) => (
        <p key={n} className="mt-2 text-xs text-amber-300/80">
          {n}
        </p>
      ))}
      <div className="mt-3" aria-busy={models === null}>
        {models === null ? (
          <RegistrySkeleton />
        ) : models.length === 0 ? (
          !error && <p className="text-xs text-gray-500">No models are defined in the catalog.</p>
        ) : (
          (["photo", "reels"] as const).map((tool) => {
            const group = models.filter((m) => m.toolKey === tool && !m.archived);
            if (group.length === 0) return null;
            return (
              <div key={tool} className="mb-2 last:mb-0">
                <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {TOOL_LABEL[tool]} · {group.filter((m) => m.enabled).length} of {group.length} offered
                </h4>
                <ul className="divide-y divide-white/5">
                  {group.map((m) => (
                    <ModelRow key={keyOf(m)} m={m} busy={saving.has(keyOf(m))} notice={notices[keyOf(m)]} onToggle={onToggle} onAdd={setAdding} onRemove={setRemoving} archiveAvailable={archiveAvailable} />
                  ))}
                </ul>
              </div>
            );
          })
        )}
        {models && models.some((m) => m.archived) ? (
          <details className="mt-3 rounded border border-white/10 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-gray-300">
              Removed models ({models.filter((m) => m.archived).length})
            </summary>
            <ul className="divide-y divide-white/5">
              {models
                .filter((m) => m.archived)
                .map((m) => (
                  <RemovedRow
                    key={keyOf(m)}
                    m={m}
                    busy={saving.has(keyOf(m))}
                    notice={notices[keyOf(m)]}
                    archiveAvailable={archiveAvailable}
                    onRestore={(x) => void archive(x, "restore")}
                  />
                ))}
            </ul>
          </details>
        ) : null}
        {models && !archiveAvailable ? (
          <p className="mt-2 text-xs text-gray-500">Remove and Restore are disabled. {MIGRATION_HINT}.</p>
        ) : null}
      </div>
      <RemoveModelDialog
        model={removing}
        archiveAvailable={archiveAvailable}
        onConfirm={() => {
          const m = removing;
          setRemoving(null);
          if (m) void archive(m, "archive");
        }}
        onCancel={() => setRemoving(null)}
      />
      <AddModelDialog
        model={adding}
        onConfirm={() => {
          const m = adding;
          setAdding(null);
          if (m) void apply(m, true);
        }}
        onCancel={() => setAdding(null)}
      />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? `Hide ${confirm.label}?` : ""}
        description="Users will no longer see this model for new generations. Jobs already running are not affected. It applies to new requests right away."
        confirmLabel="Hide model"
        onConfirm={() => {
          const m = confirm;
          setConfirm(null);
          if (m) void apply(m, false);
        }}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
