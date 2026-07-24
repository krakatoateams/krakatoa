"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Filter } from "lucide-react";
import { ChipDropdown } from "@/components/studio/ChipDropdown";
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
import {
  AdminConfigSkeleton,
  AdminToast,
  useAdminToast,
} from "../admin-ui";
import { PHOTO_FEATURES } from "@/lib/creation-features";
import { VIDEO_COMPOSER_FEATURES } from "@/lib/video-composer-features";
import { TOOL_CONFIG_UPDATED_EVENT } from "@/lib/tool-config-events";

const INPUT =
  "w-full min-h-[36px] rounded border border-gray-700/80 bg-gray-950 px-2 py-1 text-sm text-white outline-none focus:border-violet-500";

function PricingNumberInput({
  value,
  onChange,
  decimals = false,
  className = INPUT,
}: {
  value: number;
  onChange: (next: number) => void;
  decimals?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? String(value);
  const pattern = decimals ? /^\d*\.?\d*$/ : /^\d*$/;

  const commit = (raw: string) => {
    if (raw === "" || raw === ".") {
      onChange(0);
      return;
    }
    const n = decimals ? parseFloat(raw) : parseInt(raw, 10);
    if (!Number.isNaN(n)) onChange(Math.max(0, decimals ? n : Math.round(n)));
  };

  return (
    <input
      type="text"
      inputMode={decimals ? "decimal" : "numeric"}
      value={display}
      onFocus={() => setDraft(String(value))}
      onChange={(e) => {
        const raw = e.target.value;
        if (!pattern.test(raw)) return;
        setDraft(raw);
        if (raw !== "" && raw !== "." && !raw.endsWith(".")) commit(raw);
      }}
      onBlur={() => {
        if (draft !== null) commit(draft);
        setDraft(null);
      }}
      className={className}
    />
  );
}

const TH =
  "px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-gray-500";

type ToolCommitFields = { enabled?: boolean; visibleInSidebar?: boolean };

function featureFilterOptions(
  toolKey: string,
  models: AdminModelNode[],
): { key: string; label: string }[] {
  const catalog =
    toolKey === "reels"
      ? VIDEO_COMPOSER_FEATURES
      : toolKey === "photo"
        ? PHOTO_FEATURES
        : [];
  const keys = new Set(models.flatMap((m) => m.features.map((f) => f.key)));
  return catalog.filter((f) => keys.has(f.key)).map((f) => ({ key: f.key, label: f.label }));
}

function modelMatchesFeatureFilter(model: AdminModelNode, featureKey: string): boolean {
  return model.features.some((f) => f.key === featureKey);
}

type DefaultOverridePrompt = {
  featureKey: string;
  featureLabel: string;
  fromModelId: string;
  fromModelLabel: string;
  toModelId: string;
  toModelLabel: string;
};

type PricingBaseline = Pick<AdminCostVariant, "providerReferenceUsd" | "credits">;

function findVariantByPricingKey(
  tools: AdminToolNode[],
  pricingKey: string
): AdminCostVariant | null {
  for (const tool of tools) {
    for (const model of tool.models) {
      const variant = model.variants.find((row) => row.pricingKey === pricingKey);
      if (variant) return variant;
    }
    for (const group of tool.pipelines) {
      const variant = group.variants.find((row) => row.pricingKey === pricingKey);
      if (variant) return variant;
    }
  }
  return null;
}

function findFeatureByModelId(
  tools: AdminToolNode[],
  featureModelId: string
): AdminFeatureToggle | null {
  for (const tool of tools) {
    for (const model of tool.models) {
      const feature = model.features.find((row) => row.featureModelId === featureModelId);
      if (feature) return feature;
    }
  }
  return null;
}

function findPipelineRoleByConfigId(
  tools: AdminToolNode[],
  modelConfigId: string
): AdminPipelineRole | null {
  for (const tool of tools) {
    for (const group of tool.pipelines) {
      const role = group.roles.find((row) => row.modelConfigId === modelConfigId);
      if (role) return role;
    }
  }
  return null;
}

function collectPricingBaselines(tools: AdminToolNode[]): Record<string, PricingBaseline> {
  const out: Record<string, PricingBaseline> = {};
  for (const tool of tools) {
    for (const model of tool.models) {
      for (const v of model.variants) {
        out[v.pricingKey] = {
          providerReferenceUsd: v.providerReferenceUsd,
          credits: v.credits,
        };
      }
    }
    for (const group of tool.pipelines) {
      for (const v of group.variants) {
        out[v.pricingKey] = {
          providerReferenceUsd: v.providerReferenceUsd,
          credits: v.credits,
        };
      }
    }
  }
  return out;
}

function isPricingDirty(
  variant: AdminCostVariant,
  saved: Record<string, PricingBaseline>
): boolean {
  const baseline = saved[variant.pricingKey];
  if (!baseline) return true;
  return (
    baseline.providerReferenceUsd !== variant.providerReferenceUsd ||
    baseline.credits !== variant.credits
  );
}

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
  saving,
  savedPricing,
  onChange,
  onSave,
  onToggle,
}: {
  variants: AdminCostVariant[];
  billingSettings: BillingSettings;
  saving: boolean;
  savedPricing: Record<string, PricingBaseline>;
  onChange: (pricingKey: string, patch: Partial<AdminCostVariant>) => void;
  onSave: (variant: AdminCostVariant) => void;
  onToggle: (variant: AdminCostVariant) => void;
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
            const dirty = isPricingDirty(v, savedPricing);
            return (
              <tr key={v.pricingKey} className={v.enabled ? "text-gray-300" : "text-gray-600"}>
                <td className="px-2 py-2 font-medium text-white">
                  {v.label}
                  {dirty ? (
                    <span className="ml-2 text-xs font-medium text-violet-400">unsaved</span>
                  ) : null}
                  {!dirty && custom ? (
                    <span className="ml-2 text-xs font-medium text-amber-400/90">custom</span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5">
                  <PricingNumberInput
                    decimals
                    value={v.providerReferenceUsd}
                    onChange={(next) => onChange(v.pricingKey, { providerReferenceUsd: next })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <PricingNumberInput
                    value={v.credits}
                    onChange={(next) => onChange(v.pricingKey, { credits: next })}
                    className={`${INPUT} font-mono text-emerald-300`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    title={`Suggest ${suggested} credits from Replicate price`}
                    onClick={() => onChange(v.pricingKey, { credits: suggested })}
                    className="whitespace-nowrap rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-400 hover:border-violet-500 hover:text-white"
                  >
                    → {suggested}
                  </button>
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={v.enabled}
                    onChange={(e) => {
                      const next = { ...v, enabled: e.target.checked };
                      onChange(v.pricingKey, { enabled: e.target.checked });
                      onToggle(next);
                    }}
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    disabled={!dirty || saving}
                    title={dirty ? "Save pricing changes" : "No unsaved changes"}
                    onClick={() => onSave(v)}
                    className={
                      dirty
                        ? "rounded bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                        : "rounded border border-gray-800 bg-gray-900/50 px-2.5 py-1 text-[11px] font-medium text-gray-600 disabled:cursor-default"
                    }
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
  onEnabledChange,
  onDefaultChange,
}: {
  features: AdminFeatureToggle[];
  tool: AdminToolNode;
  modelId: string;
  onEnabledChange: (key: string, enabled: boolean) => void;
  onDefaultChange: (key: string, checked: boolean) => void;
}) {
  return (
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
  );
}

function PipelineRolesTable({
  roles,
  onEnabledChange,
}: {
  roles: AdminPipelineRole[];
  onEnabledChange: (role: AdminPipelineRole, enabled: boolean) => void;
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
                  onChange={(e) => onEnabledChange(role, e.target.checked)}
                />
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
  saving,
  savedPricing,
  onChange,
  onCommitRole,
  onSaveVariant,
  onToggleVariant,
}: {
  pipelines: AdminPipelineGroup[];
  storyboardModels: string[];
  billingSettings: BillingSettings;
  saving: boolean;
  savedPricing: Record<string, PricingBaseline>;
  onChange: (groupKey: string, patch: Partial<AdminPipelineGroup>) => void;
  onCommitRole: (role: AdminPipelineRole) => void;
  onSaveVariant: (variant: AdminCostVariant) => void;
  onToggleVariant: (variant: AdminCostVariant) => void;
}) {
  const [open, setOpen] = useState(false);
  if (pipelines.length === 0) return null;

  const patchRole = (groupKey: string, role: AdminPipelineRole, enabled: boolean) => {
    const group = pipelines.find((g) => g.key === groupKey);
    if (!group) return;
    const next = { ...role, enabled };
    onChange(groupKey, {
      roles: group.roles.map((r) =>
        r.modelConfigId === role.modelConfigId ? next : r
      ),
    });
    onCommitRole(next);
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
                onEnabledChange={(role, enabled) => patchRole(group.key, role, enabled)}
              />

              {group.variants.length > 0 ? (
                <VariantTable
                  variants={group.variants}
                  billingSettings={billingSettings}
                  saving={saving}
                  savedPricing={savedPricing}
                  onChange={(pricingKey, patch) => patchVariant(group.key, pricingKey, patch)}
                  onSave={onSaveVariant}
                  onToggle={onToggleVariant}
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
  saving,
  savedPricing,
  onChange,
  onEnabledChange,
  onDefaultChange,
  onSaveVariant,
  onToggleVariant,
  onCommitCatalog,
}: {
  model: AdminModelNode;
  tool: AdminToolNode;
  billingSettings: BillingSettings;
  defaultOpen?: boolean;
  saving: boolean;
  savedPricing: Record<string, PricingBaseline>;
  onChange: (patch: Partial<AdminModelNode>) => void;
  onEnabledChange: (modelId: string, featureKey: string, enabled: boolean) => void;
  onDefaultChange: (modelId: string, featureKey: string, checked: boolean) => void;
  onSaveVariant: (variant: AdminCostVariant) => void;
  onToggleVariant: (variant: AdminCostVariant) => void;
  onCommitCatalog: (modelId: string, enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const showModes = model.features.length > 0;
  const modeSummary = model.features.map((f) => f.label).join(" · ");

  const setVariant = (pricingKey: string, patch: Partial<AdminCostVariant>) => {
    onChange({
      variants: model.variants.map((v) => (v.pricingKey === pricingKey ? { ...v, ...patch } : v)),
    });
  };

  return (
    <div className={`border-l border-gray-800/60 pl-3 ${model.enabled ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-2 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-500" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-500" />
          )}
          <span className="text-sm font-medium text-white">{model.label}</span>
          {modeSummary ? (
            <>
              <span className="text-gray-600" aria-hidden>
                ·
              </span>
              <span className="truncate text-sm font-normal text-gray-500">{modeSummary}</span>
            </>
          ) : null}
        </button>
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={model.enabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              onChange({ enabled });
              onCommitCatalog(model.id, enabled);
            }}
          />
          On
        </label>
      </div>

      {open ? (
        <div className="space-y-4 pb-3 pl-5">
          {showModes ? (
            <ModesTable
              features={model.features}
              tool={tool}
              modelId={model.id}
              onEnabledChange={(key, enabled) => onEnabledChange(model.id, key, enabled)}
              onDefaultChange={(key, checked) => onDefaultChange(model.id, key, checked)}
            />
          ) : null}

          <VariantTable
            variants={model.variants}
            billingSettings={billingSettings}
            saving={saving}
            savedPricing={savedPricing}
            onChange={setVariant}
            onSave={onSaveVariant}
            onToggle={onToggleVariant}
          />
        </div>
      ) : null}
    </div>
  );
}

function ToolSection({
  tool,
  billingSettings,
  saving,
  savedPricing,
  onChange,
  onCommitTool,
  onSaveVariant,
  onToggleVariant,
  onCommitMode,
  onCommitCatalog,
  onCommitPipelineRole,
}: {
  tool: AdminToolNode;
  billingSettings: BillingSettings;
  saving: boolean;
  savedPricing: Record<string, PricingBaseline>;
  onChange: (patch: Partial<AdminToolNode>) => void;
  onCommitTool: (fields: ToolCommitFields) => void;
  onSaveVariant: (variant: AdminCostVariant) => void;
  onToggleVariant: (variant: AdminCostVariant) => void;
  onCommitMode: (featureModelId: string) => void;
  onCommitCatalog: (modelId: string, enabled: boolean) => void;
  onCommitPipelineRole: (role: AdminPipelineRole) => void;
}) {
  const [open, setOpen] = useState(tool.toolKey === "reels" || tool.toolKey === "photo");
  const [featureFilter, setFeatureFilter] = useState("all");
  const [overridePrompt, setOverridePrompt] = useState<DefaultOverridePrompt | null>(null);

  const featureOptions = featureFilterOptions(tool.toolKey, tool.models);
  const visibleModels =
    featureFilter === "all"
      ? tool.models
      : tool.models.filter((m) => modelMatchesFeatureFilter(m, featureFilter));

  const featureFilterChipOptions = [
    { id: "all", label: "All features" },
    ...featureOptions.map((opt) => ({ id: opt.key, label: opt.label })),
  ];
  const featureFilterLabel =
    featureFilter === "all"
      ? "All features"
      : (featureOptions.find((opt) => opt.key === featureFilter)?.label ?? "All features");

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

  const commitModeRow = (modelId: string, featureKey: string) => {
    const m = tool.models.find((row) => row.id === modelId);
    const f = m?.features.find((row) => row.key === featureKey);
    onCommitMode(f?.featureModelId ?? "");
  };

  const handleEnabledChange = (modelId: string, featureKey: string, enabled: boolean) => {
    const m = tool.models.find((row) => row.id === modelId);
    if (!m) return;
    const feature = m.features.find((f) => f.key === featureKey);
    if (!feature) return;
    const isDefault = enabled ? feature.isDefault : false;
    patchModel(modelId, {
      features: m.features.map((f) =>
        f.key === featureKey ? { ...f, enabled, isDefault } : f
      ),
    });
    commitModeRow(modelId, featureKey);
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
      commitModeRow(modelId, featureKey);
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
    commitModeRow(modelId, featureKey);
  };

  const confirmOverride = () => {
    if (!overridePrompt) return;
    const { featureKey, toModelId } = overridePrompt;
    onChange(applyDefaultForMode(tool, featureKey, toModelId));
    commitModeRow(toModelId, featureKey);
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
            onChange={(e) => {
              const enabled = e.target.checked;
              onChange({ enabled });
              onCommitTool({ enabled });
            }}
          />
          On
        </label>
        <label
          className="inline-flex items-center gap-1.5 text-xs text-gray-400"
          title="Show in the dashboard sidebar. The link stays hidden while On is unchecked."
        >
          <input
            type="checkbox"
            checked={tool.visibleInSidebar}
            onChange={(e) => {
              const visibleInSidebar = e.target.checked;
              onChange({ visibleInSidebar });
              onCommitTool({ visibleInSidebar });
            }}
          />
          Sidebar
        </label>
      </div>

      {open && (tool.models.length > 0 || tool.pipelines.length > 0) ? (
        <div className="px-3 py-2">
          {featureOptions.length > 0 ? (
            <div className="mb-2 flex flex-wrap items-center gap-3 border-b border-gray-800/60 pb-2">
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                Filter by feature
              </span>
              <ChipDropdown
                icon={<Filter className="h-3.5 w-3.5" />}
                value={featureFilterLabel}
                activeId={featureFilter}
                options={featureFilterChipOptions}
                onSelect={setFeatureFilter}
                square
                sheetTitle="Filter by feature"
              />
              {featureFilter !== "all" ? (
                <span className="text-xs text-gray-500">
                  {visibleModels.length} model{visibleModels.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
          ) : null}

          {visibleModels.length === 0 && featureFilter !== "all" ? (
            <p className="py-4 text-sm text-gray-500">No models support this feature.</p>
          ) : null}

          {visibleModels.map((m) => (
            <ModelSection
              key={m.id}
              model={m}
              tool={tool}
              billingSettings={billingSettings}
              defaultOpen={m.id === "balanced" || m.id === "seedance2_fast"}
              saving={saving}
              savedPricing={savedPricing}
              onChange={(patch) => patchModel(m.id, patch)}
              onEnabledChange={handleEnabledChange}
              onDefaultChange={handleDefaultChange}
              onSaveVariant={onSaveVariant}
              onToggleVariant={onToggleVariant}
              onCommitCatalog={onCommitCatalog}
            />
          ))}

          <PipelineSection
            pipelines={tool.pipelines}
            storyboardModels={storyboardModels}
            billingSettings={billingSettings}
            saving={saving}
            savedPricing={savedPricing}
            onChange={patchPipeline}
            onCommitRole={onCommitPipelineRole}
            onSaveVariant={onSaveVariant}
            onToggleVariant={onToggleVariant}
          />
        </div>
      ) : null}
    </section>
    </>
  );
}

export default function AdminConfigV2Page() {
  const [tools, setTools] = useState<AdminToolNode[]>([]);
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const [billingSettings, setBillingSettings] = useState<BillingSettings>(DEFAULT_BILLING_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedPricing, setSavedPricing] = useState<Record<string, PricingBaseline>>({});
  const { toast, dismiss, show: showToast } = useAdminToast();
  const debouncersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const savingCountRef = useRef(0);
  const saveBatchErroredRef = useRef(false);
  const catalogPendingRef = useRef(new Map<string, boolean>());
  const autosaveInflightRef = useRef(new Map<string, Promise<void>>());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [toolsRes, pricingRes, fmRes, catalogRes, modelsRes, billingRes] = await Promise.all([
        fetch("/api/admin/config/tools"),
        fetch("/api/admin/config/pricing"),
        fetch("/api/admin/config/feature-models"),
        fetch("/api/admin/config/model-catalog"),
        fetch("/api/admin/config/models"),
        fetch("/api/credits/pricing"),
      ]);

      if (!fmRes.ok) {
        const body = await fmRes.json().catch(() => ({}));
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : `Failed to load feature-model configs (${fmRes.status}).`
        );
      }
      if (!catalogRes.ok) {
        const body = await catalogRes.json().catch(() => ({}));
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : `Failed to load model catalog (${catalogRes.status}). Apply migration 048.`
        );
      }

      const toolsData = await toolsRes.json();
      const pricingResData = await pricingRes.json();
      const fmData = await fmRes.json();
      const catalogData = await catalogRes.json();
      const modelsData = modelsRes.ok ? await modelsRes.json() : { models: [] };
      const billingResData = billingRes.ok ? await billingRes.json() : null;

      const settings = normalizeBillingSettings(billingResData?.billingSettings);
      setBillingSettings(settings);

      const pricing = ((pricingResData.pricing ?? []) as Array<Record<string, unknown>>).map((row) => ({
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

      const modelConfigs = ((modelsData.models ?? []) as Array<Record<string, unknown>>).map(
        (row) => ({
          id: String(row.id),
          tool_key: String(row.tool_key),
          config_key: String(row.config_key),
          provider: String(row.provider ?? ""),
          model: String(row.model ?? ""),
          enabled: Boolean(row.enabled),
        })
      );

      const modelCatalog = ((catalogData.modelCatalog ?? []) as Array<Record<string, unknown>>).map(
        (row) => ({
          id: String(row.id),
          tool_key: String(row.tool_key),
          model_id: String(row.model_id),
          enabled: Boolean(row.enabled),
        })
      );

      const tree = buildAdminConfigTree({
          tools: toolsData.tools ?? [],
          pricing,
          featureModels: fmData.featureModels ?? [],
          modelCatalog,
          modelConfigs,
          billingSettings: settings,
        });
      setTools(tree);
      setSavedPricing(collectPricingBaselines(tree));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patchTool = (toolKey: string, patch: Partial<AdminToolNode>) => {
    setTools((prev) => {
      const next = prev.map((t) => (t.toolKey === toolKey ? { ...t, ...patch } : t));
      toolsRef.current = next;
      return next;
    });
  };

  const patchApi = async (url: string, body: Record<string, unknown>) => {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  };

  const executeAutosave = useCallback(async (fn: () => Promise<void>) => {
    const isFirst = savingCountRef.current === 0;
    savingCountRef.current += 1;
    if (isFirst) {
      saveBatchErroredRef.current = false;
      showToast({ type: "loading", message: "Saving…" });
    }
    setSaving(true);
    try {
      await fn();
    } catch (e) {
      saveBatchErroredRef.current = true;
      showToast({
        type: "error",
        message: e instanceof Error ? e.message : "Failed to save.",
      });
    } finally {
      savingCountRef.current -= 1;
      if (savingCountRef.current <= 0) {
        savingCountRef.current = 0;
        setSaving(false);
        if (!saveBatchErroredRef.current) {
          showToast({ type: "success", message: "Saved." });
        }
        saveBatchErroredRef.current = false;
      }
    }
  }, [showToast]);

  const scheduleAutosave = useCallback(
    (key: string, fn: () => Promise<void>, debounceMs = 0) => {
      const timers = debouncersRef.current;
      const prev = timers.get(key);
      if (prev) clearTimeout(prev);

      const run = async () => {
        const inflight = autosaveInflightRef.current.get(key);
        if (inflight) await inflight.catch(() => {});
        const task = executeAutosave(fn);
        autosaveInflightRef.current.set(key, task);
        try {
          await task;
        } finally {
          if (autosaveInflightRef.current.get(key) === task) {
            autosaveInflightRef.current.delete(key);
          }
        }
      };

      if (debounceMs > 0) {
        timers.set(
          key,
          setTimeout(() => {
            timers.delete(key);
            void run();
          }, debounceMs)
        );
        return;
      }
      void run();
    },
    [executeAutosave]
  );

  const commitTool = useCallback(
    (toolKey: string, overrides: ToolCommitFields = {}) => {
      scheduleAutosave(`tool:${toolKey}`, async () => {
        const tool = toolsRef.current.find((t) => t.toolKey === toolKey);
        if (!tool) throw new Error("Tool not found — click Refresh, then try again.");
        await patchApi(`/api/admin/config/tools/${toolKey}`, {
          enabled: overrides.enabled ?? tool.enabled,
          visible_in_sidebar: overrides.visibleInSidebar ?? tool.visibleInSidebar,
          sort_order: tool.sortOrder,
        });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(TOOL_CONFIG_UPDATED_EVENT));
        }
      }, 300);
    },
    [scheduleAutosave]
  );

  const saveVariant = useCallback(
    (variant: AdminCostVariant) => {
      const { pricingKey } = variant;
      scheduleAutosave(`pricing:${pricingKey}`, async () => {
        const live = findVariantByPricingKey(toolsRef.current, pricingKey);
        if (!live) throw new Error("Pricing row not found — click Refresh, then try again.");
        await patchApi(`/api/admin/config/pricing/${pricingKey}`, {
          credit_amount: Math.round(live.credits),
          provider_cost_usd: live.providerReferenceUsd,
          enabled: live.enabled,
        });
        setSavedPricing((prev) => ({
          ...prev,
          [pricingKey]: {
            providerReferenceUsd: live.providerReferenceUsd,
            credits: live.credits,
          },
        }));
      });
    },
    [scheduleAutosave]
  );

  const toggleVariant = useCallback(
    (variant: AdminCostVariant) => {
      const { pricingKey } = variant;
      scheduleAutosave(`pricing-toggle:${pricingKey}`, async () => {
        const live = findVariantByPricingKey(toolsRef.current, pricingKey);
        if (!live) throw new Error("Pricing row not found — click Refresh, then try again.");
        await patchApi(`/api/admin/config/pricing/${pricingKey}`, {
          credit_amount: Math.round(live.credits),
          provider_cost_usd: live.providerReferenceUsd,
          enabled: live.enabled,
        });
      });
    },
    [scheduleAutosave]
  );

  const commitPipelineRole = useCallback(
    (role: AdminPipelineRole) => {
      const modelConfigId = role.modelConfigId;
      if (!modelConfigId) {
        scheduleAutosave(`mc:missing:${role.modelConfigToolKey}:${role.configKey}`, async () => {
          throw new Error("Pipeline role has no DB row — run db:setup to persist toggles.");
        });
        return;
      }
      scheduleAutosave(`mc:${modelConfigId}`, async () => {
        const live = findPipelineRoleByConfigId(toolsRef.current, modelConfigId);
        if (!live?.modelConfigId) {
          throw new Error("Pipeline role not found — click Refresh, then try again.");
        }
        await patchApi(`/api/admin/config/models/${modelConfigId}`, { enabled: live.enabled });
      });
    },
    [scheduleAutosave]
  );

  const commitModelCatalog = useCallback(
    (modelId: string, enabled: boolean) => {
      catalogPendingRef.current.set(modelId, enabled);
      scheduleAutosave(`catalog:${modelId}`, async () => {
        const live = toolsRef.current.flatMap((t) => t.models).find((m) => m.id === modelId);
        if (!live?.catalogConfigId) {
          throw new Error("Catalog row missing — click Refresh, then try again.");
        }
        do {
          const targetEnabled = catalogPendingRef.current.get(modelId);
          if (targetEnabled === undefined) {
            throw new Error("Catalog save cancelled — toggle On again.");
          }
          await patchApi(`/api/admin/config/model-catalog/${live.catalogConfigId}`, {
            enabled: targetEnabled,
          });
          if (catalogPendingRef.current.get(modelId) === targetEnabled) break;
        } while (true);
      });
    },
    [scheduleAutosave]
  );

  const commitFeatureMode = useCallback(
    (featureModelId: string) => {
      scheduleAutosave(`fm:${featureModelId || "missing"}`, async () => {
        if (!featureModelId) {
          throw new Error("Mode row missing — click Refresh, then try again.");
        }
        const feature = findFeatureByModelId(toolsRef.current, featureModelId);
        if (!feature?.featureModelId) {
          throw new Error("Mode row missing — click Refresh, then try again.");
        }
        await patchApi(`/api/admin/config/feature-models/${featureModelId}`, {
          enabled: feature.enabled,
          is_default: feature.isDefault,
        });
      });
    },
    [scheduleAutosave]
  );

  if (loading) return <AdminConfigSkeleton />;

  return (
    <>
      {toast ? <AdminToast toast={toast} onDismiss={dismiss} /> : null}
      <div className="mx-auto max-w-5xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <span>
          Credits = user charge · Replicate $ = provider reference · toggles save automatically · pricing rows use Save ·{" "}
          <button type="button" onClick={() => void load()} className="text-violet-400 hover:text-violet-300">
            Refresh
          </button>
        </span>
      </div>

      {loadError ? <p className="text-xs text-red-400">{loadError}</p> : null}

      <div className="space-y-2">
          {tools.map((tool) => (
            <ToolSection
              key={tool.toolKey}
              tool={tool}
              billingSettings={billingSettings}
              saving={saving}
              savedPricing={savedPricing}
              onChange={(patch) => patchTool(tool.toolKey, patch)}
              onCommitTool={(fields) => commitTool(tool.toolKey, fields)}
              onSaveVariant={saveVariant}
              onToggleVariant={toggleVariant}
              onCommitMode={commitFeatureMode}
              onCommitCatalog={commitModelCatalog}
              onCommitPipelineRole={commitPipelineRole}
            />
          ))}
      </div>
      </div>
    </>
  );
}
