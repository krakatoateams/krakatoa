"use client";

import { useCallback, useEffect, useState } from "react";
import type { RegistryModel } from "@/lib/model-registry";
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

/** Fal-bound tiers without a key run on Replicate at runtime: say so instead of "fal.ai". */
function providerText(m: RegistryModel): string {
  return m.provider.id === "fal" && !m.provider.configured ? "Running on Replicate (Fal is not configured)" : m.provider.label;
}

function ModelRow({
  m,
  busy,
  notice,
  onToggle,
}: {
  m: RegistryModel;
  busy: boolean;
  notice: string[] | undefined;
  onToggle: (m: RegistryModel, enabled: boolean) => void;
}) {
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
        {busy ? <span className="text-[11px] text-gray-400">Saving…</span> : null}
      </div>
    </li>
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

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/config/model-registry");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { models: RegistryModel[]; notes?: string[] };
      setModels(data.models);
      setNotes(data.notes ?? []);
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
            Turn a model on or off for users. Changes take up to a minute to apply to new requests; jobs already
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
            const group = models.filter((m) => m.toolKey === tool);
            if (group.length === 0) return null;
            return (
              <div key={tool} className="mb-2 last:mb-0">
                <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {TOOL_LABEL[tool]} · {group.filter((m) => m.enabled).length} of {group.length} offered
                </h4>
                <ul className="divide-y divide-white/5">
                  {group.map((m) => (
                    <ModelRow key={keyOf(m)} m={m} busy={saving.has(keyOf(m))} notice={notices[keyOf(m)]} onToggle={onToggle} />
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? `Hide ${confirm.label}?` : ""}
        description="Users will no longer see this model for new generations. Jobs already running are not affected. It takes up to a minute to apply."
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
