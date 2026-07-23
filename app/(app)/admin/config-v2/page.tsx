"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  type AdminCostVariant,
  type AdminFeatureToggle,
  type AdminModelNode,
  type AdminPipelineGroup,
  type AdminPipelineRole,
  type AdminToolNode,
  buildAdminConfigTree,
  suggestCreditsFromProvider,
} from "@/lib/admin-config-tree";
import {
  DEFAULT_BILLING_SETTINGS,
  normalizeBillingSettings,
  type BillingSettings,
  type CostUnit,
} from "@/lib/pricing-math";

const SAVE_NOTICE = "Saved — live in ~60s.";
const TH =
  "px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-gray-500";
const INPUT =
  "w-full min-h-[36px] rounded border border-gray-700/80 bg-gray-950 px-2 py-1 text-sm text-white outline-none focus:border-violet-500";

type DefaultOverridePrompt = {
  featureKey: string;
  featureLabel: string;
  fromModelId: string;
  fromModelLabel: string;
  toModelId: string;
  toModelLabel: string;
};

/** Who holds default for a mode across all models in a tool (exclusive per mode). */
function findDefaultHolder(
  tool: AdminToolNode,
  featureKey: string,
  excludeModelId?: string
): { modelId: string; modelLabel: string } | null {
  for (const m of tool.models) {
    if (m.id === excludeModelId) continue;
    const f = m.features.find((row) => row.key === featureKey && row.isDefault && row.enabled);
    if (f) return { modelId: m.id, modelLabel: m.label };
  }
  return null;
}

function isSoleDefault(tool: AdminToolNode, modelId: string, featureKey: string): boolean {
  let holders = 0;
  let selfIsHolder = false;
  for (const m of tool.models) {
    for (const f of m.features) {
      if (f.key === featureKey && f.isDefault && f.enabled) {
        holders++;
        if (m.id === modelId) selfIsHolder = true;
      }
    }
  }
  return selfIsHolder && holders <= 1;
}

function applyDefaultForMode(tool: AdminToolNode, featureKey: string, modelId: string): AdminToolNode {
  return {
    ...tool,
    models: tool.models.map((m) => ({
      ...m,
      features: m.features.map((f) => {
        if (f.key !== featureKey) return f;
        return { ...f, isDefault: m.id === modelId };
      }),
    })),
  };
}

function OverrideDefaultDialog({
  prompt,
  onConfirm,
  onCancel,
}: {
  prompt: DefaultOverridePrompt | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!prompt) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="override-default-title"
    >
      <div className="w-full max-w-sm rounded-lg border border-gray-700 bg-gray-900 p-5 shadow-2xl">
        <h3 id="override-default-title" className="text-sm font-semibold text-white">
          Change default model?
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-400">
          <span className="text-white">{prompt.fromModelLabel}</span> is the default for{" "}
          <span className="text-white">{prompt.featureLabel}</span>. Set{" "}
          <span className="text-white">{prompt.toModelLabel}</span> as default instead?
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-300 hover:border-gray-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
          >
            Override
          </button>
        </div>
      </div>
    </div>
  );
}

function VariantTable({
  variants,
  billingSettings,
  busy,
  onChange,
  onSave,
}: {
  variants: AdminCostVariant[];
  billingSettings: BillingSettings;
  busy: boolean;
  onChange: (pricingKey: string, patch: Partial<AdminCostVariant>) => void;
  onSave: (variant: AdminCostVariant) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800/80">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-800 bg-gray-900/40">
          <tr>
            <th className={TH}>Variant</th>
            <th className={`${TH} w-24`}>Replicate $</th>
            <th className={`${TH} w-20`}>Credits</th>
            <th className={`${TH} w-16`}></th>
            <th className={`${TH} w-10`}>On</th>
            <th className={`${TH} w-16`}></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/80">
          {variants.map((v) => {
            const suggested = suggestCreditsFromProvider(v.providerReferenceUsd, billingSettings);
            const custom = v.credits !== suggested;
            return (
              <tr key={v.pricingKey} className={v.enabled ? "text-gray-300" : "text-gray-600"}>
                <td className="px-2 py-2 font-medium text-white">
                  {v.label}
                  {custom ? (
                    <span className="ml-1.5 text-[10px] font-normal text-amber-400/80">custom</span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min={0}
                    step={0.001}
                    value={v.providerReferenceUsd}
                    onChange={(e) =>
                      onChange(v.pricingKey, { providerReferenceUsd: Number(e.target.value) })
                    }
                    className={INPUT}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={v.credits}
                    onChange={(e) => onChange(v.pricingKey, { credits: Number(e.target.value) })}
                    className={`${INPUT} font-mono text-emerald-300`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    title={`Suggest ${suggested} credits from Replicate price`}
                    onClick={() => onChange(v.pricingKey, { credits: suggested })}
                    className="whitespace-nowrap rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-400 hover:border-violet-500 hover:text-white disabled:opacity-50"
                  >
                    → {suggested}
                  </button>
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={v.enabled}
                    onChange={(e) => onChange(v.pricingKey, { enabled: e.target.checked })}
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSave(v)}
                    className="rounded bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                  >
                    Save
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ModesTable({
  features,
  tool,
  modelId,
  persist,
  busy,
  onEnabledChange,
  onDefaultChange,
  onSaveAll,
}: {
  features: AdminFeatureToggle[];
  tool: AdminToolNode;
  modelId: string;
  persist: boolean;
  busy: boolean;
  onEnabledChange: (key: string, enabled: boolean) => void;
  onDefaultChange: (key: string, checked: boolean) => void;
  onSaveAll: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-gray-800/80">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-800 bg-gray-900/40">
            <tr>
              <th className={TH}>Mode</th>
              <th className={`${TH} w-12`}>On</th>
              <th className={`${TH} w-16`}>Default</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/80">
            {features.map((f) => {
              const soleDefault = isSoleDefault(tool, modelId, f.key);
              return (
                <tr key={f.key} className="text-gray-300">
                  <td className="px-2 py-2 text-white">{f.label}</td>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={f.enabled}
                      onChange={(e) => onEnabledChange(f.key, e.target.checked)}
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={f.isDefault}
                      disabled={!f.enabled || (f.isDefault && soleDefault)}
                      title={
                        f.isDefault && soleDefault
                          ? "This mode needs a default — set another model first"
                          : undefined
                      }
                      onChange={(e) => onDefaultChange(f.key, e.target.checked)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {persist ? (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onSaveAll}
            className="rounded bg-violet-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            Save modes
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PipelineRolesTable({
  roles,
  busy,
  onEnabledChange,
  onSave,
}: {
  roles: AdminPipelineRole[];
  busy: boolean;
  onEnabledChange: (modelConfigId: string, enabled: boolean) => void;
  onSave: (role: AdminPipelineRole) => void;
}) {
  if (roles.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800/80">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-800 bg-gray-900/40">
          <tr>
            <th className={TH}>Role</th>
            <th className={TH}>Provider / model</th>
            <th className={`${TH} w-12`}>On</th>
            <th className={`${TH} w-16`}></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/80">
          {roles.map((role) => (
            <tr key={`${role.modelConfigToolKey}.${role.configKey}`} className="text-gray-300">
              <td className="px-2 py-2">
                <div className="text-white">{role.label}</div>
                {role.description ? (
                  <div className="text-[11px] text-gray-500">{role.description}</div>
                ) : null}
              </td>
              <td className="px-2 py-2 font-mono text-[11px] text-gray-400">
                {role.provider}/{role.model}
              </td>
              <td className="px-2 py-2 text-center">
                <input
                  type="checkbox"
                  checked={role.enabled}
                  disabled={!role.modelConfigId}
                  title={role.modelConfigId ? undefined : "No DB row — run db:setup to persist toggles"}
                  onChange={(e) => {
                    if (role.modelConfigId) onEnabledChange(role.modelConfigId, e.target.checked);
                  }}
                />
              </td>
              <td className="px-2 py-1.5 text-right">
                <button
                  type="button"
                  disabled={busy || !role.modelConfigId}
                  onClick={() => onSave(role)}
                  className="rounded bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  Save
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PipelineSection({
  pipelines,
  storyboardModels,
  billingSettings,
  busy,
  onChange,
  onSaveRole,
  onSaveVariant,
}: {
  pipelines: AdminPipelineGroup[];
  storyboardModels: string[];
  billingSettings: BillingSettings;
  busy: boolean;
  onChange: (groupKey: string, patch: Partial<AdminPipelineGroup>) => void;
  onSaveRole: (role: AdminPipelineRole) => void;
  onSaveVariant: (variant: AdminCostVariant) => void;
}) {
  const [open, setOpen] = useState(false);
  if (pipelines.length === 0) return null;

  const patchRole = (groupKey: string, modelConfigId: string, enabled: boolean) => {
    const group = pipelines.find((g) => g.key === groupKey);
    if (!group) return;
    onChange(groupKey, {
      roles: group.roles.map((r) =>
        r.modelConfigId === modelConfigId ? { ...r, enabled } : r
      ),
    });
  };

  const patchVariant = (groupKey: string, pricingKey: string, patch: Partial<AdminCostVariant>) => {
    const group = pipelines.find((g) => g.key === groupKey);
    if (!group) return;
    onChange(groupKey, {
      variants: group.variants.map((v) => (v.pricingKey === pricingKey ? { ...v, ...patch } : v)),
    });
  };

  return (
    <div className="mt-3 border-t border-gray-800/80 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-1.5 text-left"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Pipeline</span>
      </button>

      {open ? (
        <div className="mt-2 space-y-4 pl-5">
          {pipelines.map((group) => (
            <div key={group.key} className="space-y-2">
              <div>
                <h3 className="text-sm font-medium text-violet-300">{group.label}</h3>
                {group.description ? (
                  <p className="text-[11px] leading-relaxed text-gray-500">{group.description}</p>
                ) : null}
                {group.key === "storyboard-video" && storyboardModels.length > 0 ? (
                  <p className="mt-1 text-[11px] text-gray-400">
                    Models with Storyboard to video:{" "}
                    <span className="text-gray-300">{storyboardModels.join(" · ")}</span>
                  </p>
                ) : null}
              </div>

              <PipelineRolesTable
                roles={group.roles}
                busy={busy}
                onEnabledChange={(id, enabled) => patchRole(group.key, id, enabled)}
                onSave={onSaveRole}
              />

              {group.variants.length > 0 ? (
                <VariantTable
                  variants={group.variants}
                  billingSettings={billingSettings}
                  busy={busy}
                  onChange={(pricingKey, patch) => patchVariant(group.key, pricingKey, patch)}
                  onSave={onSaveVariant}
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ModelSection({
  model,
  tool,
  billingSettings,
  defaultOpen,
  busy,
  onChange,
  onEnabledChange,
  onDefaultChange,
  onSaveVariant,
  onSaveToolModes,
}: {
  model: AdminModelNode;
  tool: AdminToolNode;
  billingSettings: BillingSettings;
  defaultOpen?: boolean;
  busy: boolean;
  onChange: (patch: Partial<AdminModelNode>) => void;
  onEnabledChange: (modelId: string, featureKey: string, enabled: boolean) => void;
  onDefaultChange: (modelId: string, featureKey: string, checked: boolean) => void;
  onSaveVariant: (variant: AdminCostVariant) => void;
  onSaveToolModes: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const showModes = model.features.length > 0;
  const modesPersist = tool.toolKey === "photo" || tool.toolKey === "reels";
  const modeSummary = model.features.map((f) => f.label).join(" · ");

  const setVariant = (pricingKey: string, patch: Partial<AdminCostVariant>) => {
    onChange({
      variants: model.variants.map((v) => (v.pricingKey === pricingKey ? { ...v, ...patch } : v)),
    });
  };

  return (
    <div className="border-l border-gray-800/60 pl-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-2 text-left"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-500" />
        )}
        <span className="text-sm font-medium text-white">{model.label}</span>
        {modeSummary ? (
          <span className="text-[11px] font-normal text-gray-500">{modeSummary}</span>
        ) : null}
      </button>

      {open ? (
        <div className="space-y-4 pb-3 pl-5">
          {showModes ? (
            <ModesTable
              features={model.features}
              tool={tool}
              modelId={model.id}
              persist={modesPersist}
              busy={busy}
              onEnabledChange={(key, enabled) => onEnabledChange(model.id, key, enabled)}
              onDefaultChange={(key, checked) => onDefaultChange(model.id, key, checked)}
              onSaveAll={onSaveToolModes}
            />
          ) : null}

          <VariantTable
            variants={model.variants}
            billingSettings={billingSettings}
            busy={busy}
            onChange={setVariant}
            onSave={onSaveVariant}
          />
        </div>
      ) : null}
    </div>
  );
}

function ToolSection({
  tool,
  billingSettings,
  busy,
  onChange,
  onSaveTool,
  onSaveVariant,
  onSaveToolModes,
  onSavePipelineRole,
}: {
  tool: AdminToolNode;
  billingSettings: BillingSettings;
  busy: boolean;
  onChange: (patch: Partial<AdminToolNode>) => void;
  onSaveTool: () => void;
  onSaveVariant: (modelId: string, variant: AdminCostVariant) => void;
  onSaveToolModes: (tool: AdminToolNode) => void;
  onSavePipelineRole: (role: AdminPipelineRole) => void;
}) {
  const [open, setOpen] = useState(tool.toolKey === "reels" || tool.toolKey === "photo");
  const [overridePrompt, setOverridePrompt] = useState<DefaultOverridePrompt | null>(null);

  const storyboardModels = tool.models
    .filter((m) => m.features.some((f) => f.key === "storyboard"))
    .map((m) => m.label);

  const patchPipeline = (groupKey: string, patch: Partial<AdminPipelineGroup>) => {
    onChange({
      pipelines: tool.pipelines.map((g) => (g.key === groupKey ? { ...g, ...patch } : g)),
    });
  };

  const patchModel = (modelId: string, patch: Partial<AdminModelNode>) => {
    onChange({
      models: tool.models.map((row) => (row.id === modelId ? { ...row, ...patch } : row)),
    });
  };

  const handleEnabledChange = (modelId: string, featureKey: string, enabled: boolean) => {
    const m = tool.models.find((row) => row.id === modelId);
    if (!m) return;
    patchModel(modelId, {
      features: m.features.map((f) =>
        f.key === featureKey
          ? { ...f, enabled, isDefault: enabled ? f.isDefault : false }
          : f
      ),
    });
  };

  const handleDefaultChange = (modelId: string, featureKey: string, checked: boolean) => {
    const m = tool.models.find((row) => row.id === modelId);
    const feature = m?.features.find((f) => f.key === featureKey);
    if (!m || !feature) return;

    if (!checked) {
      patchModel(modelId, {
        features: m.features.map((f) =>
          f.key === featureKey ? { ...f, isDefault: false } : f
        ),
      });
      return;
    }

    const incumbent = findDefaultHolder(tool, featureKey, modelId);
    if (incumbent) {
      setOverridePrompt({
        featureKey,
        featureLabel: feature.label,
        fromModelId: incumbent.modelId,
        fromModelLabel: incumbent.modelLabel,
        toModelId: modelId,
        toModelLabel: m.label,
      });
      return;
    }

    onChange(applyDefaultForMode(tool, featureKey, modelId));
  };

  const confirmOverride = () => {
    if (!overridePrompt) return;
    onChange(applyDefaultForMode(tool, overridePrompt.featureKey, overridePrompt.toModelId));
    setOverridePrompt(null);
  };

  return (
    <>
      <OverrideDefaultDialog
        prompt={overridePrompt}
        onConfirm={confirmOverride}
        onCancel={() => setOverridePrompt(null)}
      />
      <section className="rounded-lg border border-gray-800/80">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-800/80 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-violet-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-violet-400" />
          )}
          <h2 className="text-sm font-semibold text-white">{tool.label}</h2>
        </button>
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={tool.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          On
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={tool.visibleInSidebar}
            onChange={(e) => onChange({ visibleInSidebar: e.target.checked })}
          />
          Sidebar
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={onSaveTool}
          className="rounded bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          Save
        </button>
      </div>

      {open && (tool.models.length > 0 || tool.pipelines.length > 0) ? (
        <div className="px-3 py-2">
          {tool.models.map((m) => (
            <ModelSection
              key={m.id}
              model={m}
              tool={tool}
              billingSettings={billingSettings}
              defaultOpen={m.id === "balanced" || m.id === "seedance2_fast"}
              busy={busy}
              onChange={(patch) => patchModel(m.id, patch)}
              onEnabledChange={handleEnabledChange}
              onDefaultChange={handleDefaultChange}
              onSaveVariant={(variant) => onSaveVariant(m.id, variant)}
              onSaveToolModes={() => onSaveToolModes(tool)}
            />
          ))}

          <PipelineSection
            pipelines={tool.pipelines}
            storyboardModels={storyboardModels}
            billingSettings={billingSettings}
            busy={busy}
            onChange={patchPipeline}
            onSaveRole={onSavePipelineRole}
            onSaveVariant={(variant) => onSaveVariant("", variant)}
          />
        </div>
      ) : null}
    </section>
    </>
  );
}

export default function AdminConfigV2Page() {
  const [tools, setTools] = useState<AdminToolNode[]>([]);
  const [billingSettings, setBillingSettings] = useState<BillingSettings>(DEFAULT_BILLING_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [toolsRes, pricingRes, fmRes, modelsRes, billingRes] = await Promise.all([
        fetch("/api/admin/config/tools").then((r) => r.json()),
        fetch("/api/admin/config/pricing").then((r) => r.json()),
        fetch("/api/admin/config/feature-models").then((r) => (r.ok ? r.json() : { featureModels: [] })),
        fetch("/api/admin/config/models").then((r) => (r.ok ? r.json() : { models: [] })),
        fetch("/api/credits/pricing").then((r) => (r.ok ? r.json() : null)),
      ]);

      const settings = normalizeBillingSettings(billingRes?.billingSettings);
      setBillingSettings(settings);

      const pricing = ((pricingRes.pricing ?? []) as Array<Record<string, unknown>>).map((row) => ({
        pricing_key: String(row.pricing_key),
        display_name: String(row.display_name),
        credit_amount: Number(row.credit_amount),
        enabled: Boolean(row.enabled),
        provider_cost_usd:
          row.provider_cost_usd === null || row.provider_cost_usd === undefined
            ? null
            : Number(row.provider_cost_usd),
        cost_unit: (row.cost_unit as CostUnit | null) ?? null,
        is_deprecated: Boolean(row.is_deprecated),
      }));

      const modelConfigs = ((modelsRes.models ?? []) as Array<Record<string, unknown>>).map(
        (row) => ({
          id: String(row.id),
          tool_key: String(row.tool_key),
          config_key: String(row.config_key),
          provider: String(row.provider ?? ""),
          model: String(row.model ?? ""),
          enabled: Boolean(row.enabled),
        })
      );

      setTools(
        buildAdminConfigTree({
          tools: toolsRes.tools ?? [],
          pricing,
          featureModels: fmRes.featureModels ?? [],
          modelConfigs,
          billingSettings: settings,
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patchTool = (toolKey: string, patch: Partial<AdminToolNode>) => {
    setTools((prev) => prev.map((t) => (t.toolKey === toolKey ? { ...t, ...patch } : t)));
  };

  const apiPatch = async (url: string, body: Record<string, unknown>) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setNotice(SAVE_NOTICE);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setBusy(false);
    }
  };

  const saveTool = (tool: AdminToolNode) =>
    apiPatch(`/api/admin/config/tools/${tool.toolKey}`, {
      enabled: tool.enabled,
      visible_in_sidebar: tool.visibleInSidebar,
      sort_order: tool.sortOrder,
    });

  const saveVariant = (variant: AdminCostVariant) =>
    apiPatch(`/api/admin/config/pricing/${variant.pricingKey}`, {
      credit_amount: Math.round(variant.credits),
      provider_cost_usd: variant.providerReferenceUsd,
      enabled: variant.enabled,
    });

  const savePipelineRole = (role: AdminPipelineRole) => {
    if (!role.modelConfigId) return;
    apiPatch(`/api/admin/config/models/${role.modelConfigId}`, { enabled: role.enabled });
  };

  const saveToolModes = async (tool: AdminToolNode) => {
    const toSave = tool.models.flatMap((m) => m.features.filter((f) => f.featureModelId));
    if (toSave.length === 0) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      for (const f of toSave) {
        const res = await fetch(`/api/admin/config/feature-models/${f.featureModelId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: f.enabled, is_default: f.isDefault }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      setNotice(SAVE_NOTICE);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <span>
          Credits = user charge · Replicate $ = provider reference ·{" "}
          <button type="button" onClick={() => void load()} className="text-violet-400 hover:text-violet-300">
            Refresh
          </button>
        </span>
      </div>

      {notice ? <p className="text-xs text-emerald-400">{notice}</p> : null}
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {loading ? <p className="text-xs text-gray-600">Loading…</p> : null}

      {!loading ? (
        <div className="space-y-2">
          {tools.map((tool) => (
            <ToolSection
              key={tool.toolKey}
              tool={tool}
              billingSettings={billingSettings}
              busy={busy}
              onChange={(patch) => patchTool(tool.toolKey, patch)}
              onSaveTool={() => saveTool(tool)}
              onSaveVariant={(_modelId, variant) => saveVariant(variant)}
              onSaveToolModes={saveToolModes}
              onSavePipelineRole={savePipelineRole}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
