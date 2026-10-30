"use client";

import { useCallback, useEffect, useState } from "react";
import type { RegistryModel } from "@/lib/model-registry";
import { Bone } from "../admin-ui";

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

function ModelRow({ m }: { m: RegistryModel }) {
  const missing = m.pricing.keys.filter((k) => !k.ready).map((k) => k.key);
  return (
    <li className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm text-white">{m.label}</p>
        <p className="truncate text-xs text-gray-500">
          {m.modelId} · {m.provider.label}
          {m.enabledIn.length > 0 ? ` · Offered in ${m.enabledIn.map((f) => f.label).join(", ")}` : ""}
        </p>
        {!m.enabled && !m.enableCheck.ok ? (
          <p className="mt-0.5 text-xs text-amber-300/80">Cannot be offered yet: {m.enableCheck.reasons.join(" ")}</p>
        ) : null}
        {m.enabled && !m.disableCheck.ok ? (
          <p className="mt-0.5 text-xs text-gray-500">Cannot be hidden: {m.disableCheck.reasons.join(" ")}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
        <Badge tone={m.enabled ? "ok" : "off"}>{m.enabled ? "Offered" : "Not offered"}</Badge>
        {m.defaultIn.length > 0 ? <Badge tone="ok">Default for {m.defaultIn.map((f) => f.label).join(", ")}</Badge> : null}
        {m.reelsEngine ? <Badge tone="off">Used by Reels Creator engine</Badge> : null}
        {!m.pricing.ready ? (
          <Badge tone="warn" title={missing.join(", ")}>
            Pricing not ready: {missing.length} {missing.length === 1 ? "key" : "keys"}
          </Badge>
        ) : null}
        {!m.provider.configured ? <Badge tone="warn">Provider not configured</Badge> : null}
        {m.availableToAdd ? <Badge tone="off">Available to add</Badge> : null}
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

/** Read-only status of every code-catalog generation model. Changing anything stays in the tool cards below. */
export function ModelRegistrySection() {
  const [models, setModels] = useState<RegistryModel[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/config/model-registry");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { models: RegistryModel[]; notes?: string[] };
      setModels(data.models);
      setNotes(data.notes ?? []);
    } catch {
      setError("Could not load the model list.");
      setModels((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-lg border border-white/10 p-3" aria-labelledby="model-registry-title">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 id="model-registry-title" className="text-sm font-semibold text-white">
            Models
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Read-only status of every model the app can run. Use the tool cards below to change what is offered.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="text-xs text-gray-300 hover:text-white">
          Refresh
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
                    <ModelRow key={`${m.toolKey}:${m.modelId}`} m={m} />
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
