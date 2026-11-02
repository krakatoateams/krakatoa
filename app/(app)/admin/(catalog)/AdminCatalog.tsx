"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Filter, RotateCcw } from "lucide-react";
import { ChipDropdown } from "@/components/studio/ChipDropdown";
import {
  type AdminCostVariant,
  type AdminFeatureToggle,
  type AdminModelNode,
  type AdminPipelineGroup,
  type AdminPipelineRole,
  type AdminProviderChoice,
  type AdminToolNode,
  type PricingBaseline,
  buildAdminConfigTree,
  collectPricingBaselines,
  isPricingDirty,
  keepPricingDrafts,
  modelsTabTools,
  priceSummary,
  splitToolModels,
  suggestCreditsFromProvider,
} from "@/lib/admin-config-tree";
import {
  readRequiredAdminConfigJson,
  requireAdminConfigRows,
} from "@/lib/admin-config-load";
import {
  DEFAULT_BILLING_SETTINGS,
  normalizeBillingSettings,
  type BillingSettings,
  type CostUnit,
} from "@/lib/pricing-math";
import {
  AdminConfigSkeleton,
  AdminModelsSkeleton,
  AdminToast,
  useAdminToast,
} from "../admin-ui";
import {
  PROVIDER_LABEL,
  providerCostKey,
  providerMargins,
  type PhotoProviderId,
  type PhotoProviderOption,
} from "@/lib/admin-provider-switch";
import { creditPacksFromApiPayload, formatIdr, lowestPackIdrPerCredit } from "@/lib/credit-packs";
import { PHOTO_FEATURES } from "@/lib/creation-features";
import { VIDEO_COMPOSER_FEATURES } from "@/lib/video-composer-features";
import { AddModelDialog, RemoveModelDialog } from "./ToolModelDialogs";
import { TOOL_CONFIG_UPDATED_EVENT } from "@/lib/tool-config-events";
import type { Platform } from "@/lib/platform-availability-pure";

const INPUT =
  "w-full min-h-[36px] rounded border border-white/10 bg-white/[0.02] px-2 py-1 text-sm text-white outline-none focus:border-white/30";

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

// pricing_configs.provider_cost_usd: deliberately the highest provider cost (#464), so the suggestion never loses money.
const HIGHEST_COST_HINT =
  "Highest cost: the most any provider charges for this variant. Suggested credits use it, so no provider loses money.";

function marginHint(sellIdrPerCredit: number | null): string {
  return sellIdrPerCredit === null
    ? "No enabled credit pack could be read, so no margin is shown."
    : `Based on the lowest pack price per credit, bonus credits included (${formatIdr(sellIdrPerCredit)}). Before payment fees.`;
}

/** The optional provider-costs and packs reads give up after this and fall back to "cost not set" / a dash. */
const OPTIONAL_READ_TIMEOUT_MS = 8_000;


/** Provider-switch data shared by the Photo model sections (fetched once by the page). */
type ProviderAdmin = {
  falConfigured: boolean;
  /** `${provider}|${model}|${pricing_key}` -> cost_usd, from provider_model_costs. */
  costs: Record<string, number>;
  /** Lowest enabled pack price per credit (IDR), the margin's revenue; null when no pack is readable. */
  sellIdrPerCredit: number | null;
  onSwitched: (configKey: string, provider: PhotoProviderId) => void;
};
/** Inline "why this was refused / what changed" messages per model id (rendered next to the model). */
const ModelNoticeContext = createContext<Record<string, string[]>>({});

class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>
  ) {
    super(message);
  }
}

const STALE_MODEL_MESSAGE = "Someone else changed this model. Review and try again.";

/** A model_catalog_configs row as the catalog routes return it (`archived_at` only after migration 118). */
type CatalogRow = { id: string; enabled: boolean; updated_at: string; archived_at?: string | null };

async function sendApi(method: "PATCH" | "POST", url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new AdminApiError(String(data.error ?? `Request failed (${res.status})`), res.status, data);
  return data;
}
const patchApi = (url: string, body: Record<string, unknown>) => sendApi("PATCH", url, body);
const postApi = (url: string, body: Record<string, unknown>) => sendApi("POST", url, body);

const ProviderAdminContext = createContext<ProviderAdmin>({
  falConfigured: false,
  costs: {},
  sellIdrPerCredit: null,
  onSwitched: () => {},
});

/**
 * The provider a tier actually runs on: Fal selected without FAL_KEY falls back to Replicate, except
 * on a Fal-only tier (#467), which has no Replicate option and stays Fal (it cannot run at all).
 */
function effectiveProvider(choice: AdminProviderChoice, falConfigured: boolean): PhotoProviderId {
  const canFallBack = choice.options.some((o) => o.provider === "replicate");
  return choice.provider === "fal" && !falConfigured && canFallBack ? "replicate" : choice.provider;
}

function PhotoProviderSwitch({ choice }: { choice: AdminProviderChoice }) {
  const { falConfigured, onSwitched } = useContext(ProviderAdminContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (choice.options.length < 2) {
    const only = choice.options[0]?.provider ?? "replicate";
    return (
      <div className="space-y-1">
        <p className="text-xs text-gray-500">Provider: {PROVIDER_LABEL[only]} only</p>
        {only === "fal" && !falConfigured ? (
          <p className="text-[11px] text-amber-400">
            fal.ai is not configured on this server (FAL_KEY missing): this model cannot run and cannot be turned on.
          </p>
        ) : null}
        {only === "fal" && (!choice.modelConfigId || choice.rowEnabled === false) ? (
          <p className="text-[11px] text-amber-400">
            Its fal.ai settings row is missing or off (apply its migration): generations are refused until it exists.
          </p>
        ) : null}
      </div>
    );
  }

  const switchTo = async (provider: PhotoProviderId) => {
    if (provider === choice.provider || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/config/photo-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config_key: choice.configKey, provider }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      onSwitched(choice.configKey, provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to switch provider.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-gray-400" htmlFor={`provider-${choice.configKey}`}>
          Provider
        </label>
        <select
          id={`provider-${choice.configKey}`}
          value={choice.provider}
          disabled={busy}
          onChange={(e) => void switchTo(e.target.value as PhotoProviderId)}
          className={`${INPUT} !w-auto min-w-[140px] disabled:opacity-60`}
        >
          {choice.options.map((o) => (
            <option key={o.provider} value={o.provider} disabled={o.provider === "fal" && !falConfigured}>
              {PROVIDER_LABEL[o.provider]}
              {o.provider === "fal" && !falConfigured ? " (not configured)" : ""}
            </option>
          ))}
        </select>
        {busy ? <span className="text-[11px] text-gray-400">Saving…</span> : null}
      </div>
      <p className="text-[11px] text-gray-500">
        Switches the model and its settings together. Applies to new generations within about 60 seconds.
        Users pay the same credits on either provider.
      </p>
      {choice.provider === "fal" && !falConfigured ? (
        <p className="text-[11px] text-amber-400">
          fal.ai is selected but not configured on this server (FAL_KEY missing): this model is running on Replicate.
        </p>
      ) : null}
      {choice.rowEnabled === false ? (
        <p className="text-[11px] text-amber-400">
          This model config is disabled, so a provider switch has no effect until it is enabled.
        </p>
      ) : null}
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}

type ToolCommitFields = { enabled?: boolean; visibleInSidebar?: boolean; comingSoon?: boolean };

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
      <div className="w-full max-w-sm rounded-lg border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
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
            className="rounded border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-300 hover:border-white/20"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-[#F26522] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#e05a1a]"
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
  providers,
}: {
  /** Photo tiers: the providers the tier can run on and the one in use, for the margin per provider. */
  providers?: { options: PhotoProviderOption[]; active: PhotoProviderId };
  variants: AdminCostVariant[];
  billingSettings: BillingSettings;
  saving: boolean;
  savedPricing: Record<string, PricingBaseline>;
  onChange: (pricingKey: string, patch: Partial<AdminCostVariant>) => void;
  onSave: (variant: AdminCostVariant) => void;
  onToggle: (variant: AdminCostVariant) => void;
}) {
  const { costs, sellIdrPerCredit } = useContext(ProviderAdminContext);
  return (
    <div>
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full text-sm">
        <thead className="border-b border-white/10 bg-white/[0.03]">
          <tr>
            <th className={TH}>Variant</th>
            <th className={`${TH} w-24`} title={HIGHEST_COST_HINT}>Highest cost $</th>
            <th className={`${TH} w-20`}>Credits</th>
            {providers ? (
              <th className={`${TH} w-40`} title={marginHint(sellIdrPerCredit)}>
                Margin per provider
              </th>
            ) : null}
            <th className={`${TH} w-16`}></th>
            <th className={`${TH} w-10`}>On</th>
            <th className={`${TH} w-16`}></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {variants.map((v) => {
            const suggested = suggestCreditsFromProvider(v.providerReferenceUsd, billingSettings);
            const custom = v.credits !== suggested;
            const dirty = isPricingDirty(v, savedPricing);
            // Costs per provider come from provider_model_costs; a missing Fal row shows "cost not set", never a guess.
            const margins = providers
              ? providerMargins({
                  credits: v.credits,
                  pricingKey: v.pricingKey,
                  referenceUsd: v.providerReferenceUsd,
                  options: providers.options,
                  activeProvider: providers.active,
                  costs,
                  settings: billingSettings,
                  sellIdrPerCredit,
                })
              : null;
            return (
              <tr key={v.pricingKey} className={v.enabled ? "text-gray-300" : "text-gray-600"}>
                <td className="px-2 py-2 font-medium text-white">
                  {v.label}
                  {dirty ? (
                    <span className="ml-2 text-xs font-medium text-gray-300">unsaved</span>
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
                {margins ? (
                  <td className="px-2 py-1.5 font-mono text-[11px]">
                    {margins.map((row) => (
                      <div
                        key={row.provider}
                        className={`whitespace-nowrap ${row.active ? "text-white" : "text-gray-500"}`}
                        title={`${row.active ? "In use. " : ""}${
                          row.recorded
                            ? "Cost from provider_model_costs."
                            : row.costUsd === null
                              ? "No cost recorded in provider_model_costs."
                              : "No recorded cost: using the highest cost."
                        }`}
                      >
                        {PROVIDER_LABEL[row.provider]} {row.costUsd === null ? "cost not set" : `$${row.costUsd}`}
                        {row.margin ? ` · ${row.margin.pct.toFixed(0)}%` : row.costUsd === null ? "" : " · —"}
                      </div>
                    ))}
                  </td>
                ) : null}
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    title={`Suggest ${suggested} credits from the highest cost`}
                    onClick={() => onChange(v.pricingKey, { credits: suggested })}
                    className="whitespace-nowrap rounded border border-white/10 px-2 py-1 text-[11px] text-gray-400 hover:border-white/30 hover:text-white"
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
                  {/* aria-disabled, not disabled: a focused button that disables itself after saving drops
                      keyboard focus to the page (#484). */}
                  <button
                    type="button"
                    aria-disabled={!dirty || saving}
                    title={dirty ? "Save pricing changes" : "No unsaved changes"}
                    onClick={() => {
                      if (dirty && !saving) onSave(v);
                    }}
                    className={
                      dirty
                        ? "rounded bg-[#F26522] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#e05a1a] aria-disabled:opacity-50"
                        : "rounded border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-gray-600 aria-disabled:cursor-default"
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
    {providers ? <p className="mt-1.5 text-[11px] text-gray-500">{HIGHEST_COST_HINT}</p> : null}
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
    <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead className="border-b border-white/10 bg-white/[0.03]">
            <tr>
              <th className={TH}>Mode</th>
              <th className={`${TH} w-12`}>On</th>
              <th className={`${TH} w-16`}>Default</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
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
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full text-sm">
        <thead className="border-b border-white/10 bg-white/[0.03]">
          <tr>
            <th className={TH}>Role</th>
            <th className={TH}>Provider / model</th>
            <th className={`${TH} w-12`}>On</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
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
  standalone = false,
}: {
  /** The tool has nothing but its pipeline (e.g. Schedule): open on arrival, no divider above. */
  standalone?: boolean;
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
  const [open, setOpen] = useState(standalone);
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
    <div className={standalone ? "" : "mt-3 border-t border-white/10 pt-3"}>
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
                <h3 className="text-sm font-medium text-gray-300">{group.label}</h3>
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
  saving,
  savedPricing,
  onChange,
  onEnabledChange,
  onDefaultChange,
  onSaveVariant,
  onToggleVariant,
  onCommitCatalog,
  onRemove,
}: {
  model: AdminModelNode;
  tool: AdminToolNode;
  billingSettings: BillingSettings;
  saving: boolean;
  savedPricing: Record<string, PricingBaseline>;
  onChange: (patch: Partial<AdminModelNode>) => void;
  onEnabledChange: (modelId: string, featureKey: string, enabled: boolean) => void;
  onDefaultChange: (modelId: string, featureKey: string, checked: boolean) => void;
  onSaveVariant: (variant: AdminCostVariant) => void;
  onToggleVariant: (variant: AdminCostVariant) => void;
  onCommitCatalog: (modelId: string, enabled: boolean) => void;
  onRemove: (model: AdminModelNode) => void;
}) {
  const { falConfigured } = useContext(ProviderAdminContext);
  const notice = useContext(ModelNoticeContext)[model.id];
  const [open, setOpen] = useState(false);
  const showModes = model.features.length > 0;
  // Quiet secondary line: where it runs and which features it serves. Pricing and modes stay in details.
  const runsOn = model.providerChoice ? PROVIDER_LABEL[effectiveProvider(model.providerChoice, falConfigured)] : "Replicate";
  const details = [runsOn, ...model.features.map((f) => f.label)].join(" · ");
  const noteId = `model-note-${tool.toolKey}-${model.id}`;
  // What users pay now (saved credits); a pending price edit is flagged, not shown as the price.
  const price = priceSummary(model.variants, savedPricing);
  const unsaved = model.variants.some((v) => isPricingDirty(v, savedPricing));
  const priceText = (
    <>
      {price}
      {unsaved ? <span className="text-amber-300/90">{price ? " · " : ""}unsaved</span> : null}
    </>
  );

  const setVariant = (pricingKey: string, patch: Partial<AdminCostVariant>) => {
    onChange({
      variants: model.variants.map((v) => (v.pricingKey === pricingKey ? { ...v, ...patch } : v)),
    });
  };

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <div className="flex items-center gap-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={model.subtitle}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
          ) : (
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
          )}
          <span className="min-w-0">
            <span className={`block truncate text-sm font-medium ${model.enabled ? "text-white" : "text-gray-400"}`}>
              {model.label}
            </span>
            <span className="block truncate text-xs normal-case text-gray-500">{details}</span>
            {price || unsaved ? (
              <span className="block truncate text-xs text-gray-300 sm:hidden">{priceText}</span>
            ) : null}
          </span>
        </button>
        {price || unsaved ? (
          <span className="hidden shrink-0 whitespace-nowrap text-xs tabular-nums text-gray-300 sm:block">
            {priceText}
          </span>
        ) : null}
        <button
          type="button"
          role="switch"
          aria-checked={model.enabled}
          aria-label={`${model.label} ${model.enabled ? "on" : "off"}`}
          aria-describedby={noteId}
          title={model.enabled ? "On: users can pick this model" : "Off: hidden from users"}
          onClick={() => {
            const enabled = !model.enabled;
            onChange({ enabled });
            onCommitCatalog(model.id, enabled);
          }}
          className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 ${
            model.enabled ? "border-emerald-400/40 bg-emerald-400/30" : "border-white/15 bg-white/10"
          }`}
        >
          <span
            className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-[left] duration-150 ${
              model.enabled ? "left-[18px]" : "left-0.5"
            }`}
          />
        </button>
        <button
          type="button"
          onClick={() => onRemove(model)}
          aria-label={`Remove ${model.label} from ${tool.label}`}
          className="shrink-0 rounded px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          Remove
        </button>
      </div>
      <p id={noteId} aria-live="polite" className={notice ? "-mt-1 pb-2.5 pl-[22px] text-xs text-amber-300/90" : "sr-only"}>
        {notice ? notice.join(" ") : ""}
      </p>

      {open ? (
        <div className="space-y-4 pb-3 pl-5">
          {model.providerChoice ? <PhotoProviderSwitch choice={model.providerChoice} /> : null}
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
            providers={
              model.providerChoice
                ? {
                    options: model.providerChoice.options,
                    active: effectiveProvider(model.providerChoice, falConfigured),
                  }
                : undefined
            }
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

/**
 * One tool's models in the Models tab: feature filter, model rows (switch, Remove, price details),
 * Restore model and the Pipeline section. Formerly the body of the Config tool card (#466: moved, not rewritten).
 */
function ToolModels({
  tool,
  billingSettings,
  saving,
  savedPricing,
  onChange,
  onSaveVariant,
  onToggleVariant,
  onCommitMode,
  onCommitCatalog,
  onCommitPipelineRole,
  onRemoveModel,
  onAddModel,
  featureFilter,
  onFeatureFilterChange,
}: {
  /** Kept per tool in the shared provider, so it survives switching tools and tabs. */
  featureFilter: string;
  onFeatureFilterChange: (featureKey: string) => void;
  tool: AdminToolNode;
  billingSettings: BillingSettings;
  saving: boolean;
  savedPricing: Record<string, PricingBaseline>;
  onChange: (patch: Partial<AdminToolNode>) => void;
  onSaveVariant: (variant: AdminCostVariant) => void;
  onToggleVariant: (variant: AdminCostVariant) => void;
  onCommitMode: (featureModelId: string) => void;
  onCommitCatalog: (modelId: string, enabled: boolean) => void;
  onCommitPipelineRole: (role: AdminPipelineRole) => void;
  onRemoveModel: (modelId: string) => void;
  onAddModel: (modelId: string) => void;
}) {
  const [overridePrompt, setOverridePrompt] = useState<DefaultOverridePrompt | null>(null);
  const [removing, setRemoving] = useState<AdminModelNode | null>(null);
  const [adding, setAdding] = useState(false);

  // One source for the list and the picker: the catalog rows behind this tree.
  const { inTool, removed } = splitToolModels(tool.models);
  const hasModelList = tool.models.length > 0;
  const featureOptions = featureFilterOptions(tool.toolKey, inTool);
  const visibleModels =
    featureFilter === "all"
      ? inTool
      : inTool.filter((m) => modelMatchesFeatureFilter(m, featureFilter));

  const featureFilterChipOptions = [
    { id: "all", label: "All features" },
    ...featureOptions.map((opt) => ({ id: opt.key, label: opt.label })),
  ];
  const featureFilterLabel =
    featureFilter === "all"
      ? "All features"
      : (featureOptions.find((opt) => opt.key === featureFilter)?.label ?? "All features");

  const storyboardModels = inTool
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
      {hasModelList ? (
        <>
          <RemoveModelDialog
            model={removing}
            toolLabel={tool.label}
            onConfirm={() => {
              const m = removing;
              setRemoving(null);
              if (m) onRemoveModel(m.id);
            }}
            onCancel={() => setRemoving(null)}
          />
          <AddModelDialog
            open={adding}
            toolKey={tool.toolKey}
            toolLabel={tool.label}
            candidates={removed}
            onAdd={(m) => {
              setAdding(false);
              onAddModel(m.id);
            }}
            onClose={() => setAdding(false)}
          />
        </>
      ) : null}
      <section className="rounded-lg border border-white/10">
      {tool.models.length > 0 || tool.pipelines.length > 0 ? (
        <div className="px-3 py-2">
          {hasModelList ? (
            <div className="mb-1 flex flex-wrap items-center gap-3 border-b border-white/10 pb-2">
              {featureOptions.length > 0 ? (
                <ChipDropdown
                  icon={<Filter className="h-3.5 w-3.5" />}
                  value={featureFilterLabel}
                  activeId={featureFilter}
                  options={featureFilterChipOptions}
                  onSelect={onFeatureFilterChange}
                  square
                  sheetTitle="Filter by feature"
                />
              ) : null}
              <span className="text-xs text-gray-500">
                {visibleModels.length} model{visibleModels.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:border-white/30 hover:bg-white/[0.06]"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Restore model
              </button>
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
              saving={saving}
              savedPricing={savedPricing}
              onChange={(patch) => patchModel(m.id, patch)}
              onEnabledChange={handleEnabledChange}
              onDefaultChange={handleDefaultChange}
              onSaveVariant={onSaveVariant}
              onToggleVariant={onToggleVariant}
              onCommitCatalog={onCommitCatalog}
              onRemove={setRemoving}
            />
          ))}

          <PipelineSection
            standalone={!hasModelList}
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

/**
 * One tool in the Config tab: only On / Sidebar / Coming soon, saved automatically (same commitTool
 * autosave as before #466). Models and prices live in the Models tab.
 */
function ToolRow({
  tool,
  onChange,
  onCommitTool,
}: {
  tool: AdminToolNode;
  onChange: (patch: Partial<AdminToolNode>) => void;
  onCommitTool: (fields: ToolCommitFields) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
      <h2 className="min-w-0 flex-1 text-sm font-semibold text-white">{tool.label}</h2>
      <div className="flex flex-wrap items-center gap-3">
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
        <label
          className="inline-flex items-center gap-1.5 text-xs text-gray-400"
          title="Shows a 'Coming soon' badge next to this tool in the sidebar. Purely cosmetic — the tool stays fully usable."
        >
          <input
            type="checkbox"
            checked={tool.comingSoon}
            onChange={(e) => {
              const comingSoon = e.target.checked;
              onChange({ comingSoon });
              onCommitTool({ comingSoon });
            }}
          />
          Coming soon
        </label>
      </div>
    </div>
  );
}

const PLATFORM_LABELS: Record<Platform, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };

/**
 * Platform availability (see CONTEXT.md) — a single per-platform flag,
 * product-wide, governing both connecting the account (Settings) and
 * selecting it in Schedule (currently the only consumer of these
 * connections). Deliberately self-contained (own fetch/save via
 * /api/platform-availability) rather than woven into the tool rows' autosave
 * machinery, since this isn't actually tool-scoped data.
 */
function PlatformAvailabilitySection() {
  const [platforms, setPlatforms] = useState<Record<Platform, boolean> | null>(null);
  const [saving, setSaving] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/platform-availability")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Failed to load"))))
      .then((data: { platforms: Record<Platform, boolean> }) => setPlatforms(data.platforms))
      .catch(() => setError("Failed to load platform availability."));
  }, []);

  const toggle = async (platform: Platform, enabled: boolean) => {
    if (!platforms) return;
    const prev = platforms;
    setPlatforms({ ...platforms, [platform]: enabled });
    setSaving(platform);
    setError(null);
    try {
      const res = await fetch("/api/platform-availability", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, enabled }),
      });
      if (!res.ok) throw new Error("Failed to save.");
    } catch {
      setPlatforms(prev);
      setError(`Failed to update ${PLATFORM_LABELS[platform]}.`);
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="rounded-lg border border-white/10 p-3">
      <h3 className="text-sm font-semibold text-white">Platform availability</h3>
      <p className="mt-0.5 text-xs text-gray-500">
        Controls whether each platform can be connected (Settings) and selected (Schedule) at all, for everyone except
        admins — admins always see a &quot;Preview&quot; badge and can use it anyway.
      </p>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-4">
        {platforms === null
          ? Object.keys(PLATFORM_LABELS).map((platform) => (
              <div key={platform} className="h-4 w-20 animate-pulse rounded bg-white/10" />
            ))
          : (Object.keys(PLATFORM_LABELS) as Platform[]).map((platform) => (
              <label key={platform} className="inline-flex items-center gap-1.5 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={platforms[platform]}
                  disabled={saving === platform}
                  onChange={(e) => toggle(platform, e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-white/20 bg-white/[0.02]"
                />
                {PLATFORM_LABELS[platform]}
              </label>
            ))}
      </div>
    </section>
  );
}

/** Everything the Config and Models tabs render, owned by one provider so state and drafts survive switching tabs. */
type CatalogState = {
  tools: AdminToolNode[];
  billingSettings: BillingSettings;
  saving: boolean;
  savedPricing: Record<string, PricingBaseline>;
  patchTool: (toolKey: string, patch: Partial<AdminToolNode>) => void;
  commitTool: (toolKey: string, overrides?: ToolCommitFields) => void;
  saveVariant: (variant: AdminCostVariant) => void;
  toggleVariant: (variant: AdminCostVariant) => void;
  commitFeatureMode: (featureModelId: string) => void;
  commitModelCatalog: (modelId: string, enabled: boolean) => void;
  commitPipelineRole: (role: AdminPipelineRole) => void;
  removeModel: (modelId: string) => void;
  addModel: (modelId: string) => void;
  /** Last tool picked in the Models tab, so coming back from Config opens the same tool. */
  modelsTool: string | null;
  setModelsTool: (toolKey: string) => void;
  featureFilters: Record<string, string>;
  setFeatureFilter: (toolKey: string, featureKey: string) => void;
};
const CatalogContext = createContext<CatalogState | null>(null);

function useCatalog(): CatalogState {
  const state = useContext(CatalogContext);
  if (!state) throw new Error("useCatalog must be used inside AdminCatalogProvider");
  return state;
}

/** Routes that share this provider: leaving them drops unsaved price drafts, so the guard asks first. */
const MODELS_PATH = "/admin/models";
const CATALOG_PATHS = ["/admin/config-v2", MODELS_PATH];
const UNSAVED_LEAVE_MESSAGE = "You have unsaved price changes. Leave without saving?";
/** History-state keys of the browser Back guard: the parked same-URL entry, and the entry it sits on. */
const BACK_GUARD_KEY = "__krakatoaUnsavedPrices";
const BACK_BASE_KEY = "__krakatoaUnsavedBase";

type BackGuardState = { base: string | null; leaving: boolean; dropping: boolean };

/** Stamp the current history entry and park a same-URL guard entry on top of it (browser Back guard). */
function parkBackGuard(g: BackGuardState): void {
  const base = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  g.base = base;
  const state = { ...window.history.state, [BACK_GUARD_KEY]: undefined };
  window.history.replaceState({ ...state, [BACK_BASE_KEY]: base }, "", window.location.href);
  window.history.pushState({ ...state, [BACK_BASE_KEY]: undefined, [BACK_GUARD_KEY]: base }, "", window.location.href);
}

function hasUnsavedPricing(tools: AdminToolNode[], saved: Record<string, PricingBaseline>): boolean {
  return tools.some(
    (t) =>
      t.models.some((m) => m.variants.some((v) => isPricingDirty(v, saved))) ||
      t.pipelines.some((g) => g.variants.some((v) => isPricingDirty(v, saved)))
  );
}

/**
 * Shared state for the Config and Models tabs (the former single Config page, #466). It lives in the
 * route group layout, so moving between the two tabs keeps every draft and does not reload.
 */
export function AdminCatalogProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [modelsTool, setModelsTool] = useState<string | null>(null);
  const [featureFilters, setFeatureFilters] = useState<Record<string, string>>({});
  const setFeatureFilter = useCallback((toolKey: string, featureKey: string) => {
    setFeatureFilters((prev) => ({ ...prev, [toolKey]: featureKey }));
  }, []);
  const [tools, setTools] = useState<AdminToolNode[]>([]);
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const [billingSettings, setBillingSettings] = useState<BillingSettings>(DEFAULT_BILLING_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedPricing, setSavedPricing] = useState<Record<string, PricingBaseline>>({});
  const savedPricingRef = useRef(savedPricing);
  savedPricingRef.current = savedPricing;
  const [falConfigured, setFalConfigured] = useState(false);
  const [providerCosts, setProviderCosts] = useState<Record<string, number>>({});
  const [sellIdrPerCredit, setSellIdrPerCredit] = useState<number | null>(null);
  const { toast, dismiss, show: showToast } = useAdminToast();
  const debouncersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const savingCountRef = useRef(0);
  const saveBatchErroredRef = useRef(false);
  const catalogPendingRef = useRef(new Map<string, boolean>());
  const [modelNotices, setModelNotices] = useState<Record<string, string[]>>({});
  const autosaveInflightRef = useRef(new Map<string, Promise<void>>());

  const load = useCallback(async (quiet = false) => {
    if (
      debouncersRef.current.size > 0 ||
      savingCountRef.current > 0 ||
      autosaveInflightRef.current.size > 0
    ) {
      setLoadError("Wait for pending changes to finish saving before refreshing.");
      return;
    }
    if (!quiet) setLoading(true);
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

      const [toolsData, pricingResData, fmData, catalogData, modelsData] =
        await Promise.all([
          readRequiredAdminConfigJson(toolsRes, "tool configs"),
          readRequiredAdminConfigJson(pricingRes, "pricing configs"),
          readRequiredAdminConfigJson(fmRes, "feature-model configs"),
          readRequiredAdminConfigJson(catalogRes, "model catalog"),
          readRequiredAdminConfigJson(modelsRes, "model configs"),
        ]);
      setFalConfigured(
        (modelsData as { configuredProviders?: { fal?: boolean } }).configuredProviders?.fal === true
      );
      // Costs and packs are optional: a missing table, a failure or no answer within 8 s leaves
      // "cost not set" / a dash (never the old cost-basis margin), never an error or a hang.
      const optionalJson = (url: string) =>
        fetch(url, { signal: AbortSignal.timeout(OPTIONAL_READ_TIMEOUT_MS) })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
      const [costsData, packsData] = await Promise.all([
        optionalJson("/api/admin/config/provider-costs"),
        optionalJson("/api/credits/packs"),
      ]);
      setProviderCosts(
        Object.fromEntries(
          ((costsData?.costs ?? []) as { provider: string; model: string; pricing_key: string; cost_usd: number }[]).map(
            (c) => [providerCostKey(c.provider, c.model, c.pricing_key), Number(c.cost_usd)]
          )
        )
      );
      setSellIdrPerCredit(lowestPackIdrPerCredit(creditPacksFromApiPayload(packsData) ?? []));
      const billingResData = billingRes.ok
        ? await billingRes.json().catch(() => null)
        : null;

      const settings = normalizeBillingSettings(billingResData?.billingSettings);

      const toolConfigs = requireAdminConfigRows(toolsData, "tools", "tool configs").map(
        (row) => ({
          tool_key: String(row.tool_key),
          display_name: String(row.display_name),
          enabled: Boolean(row.enabled),
          visible_in_sidebar: Boolean(row.visible_in_sidebar),
          coming_soon: Boolean(row.coming_soon),
          sort_order: Number(row.sort_order),
        })
      );
      const pricing = requireAdminConfigRows(
        pricingResData,
        "pricing",
        "pricing configs"
      ).map((row) => ({
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

      const featureModels = requireAdminConfigRows(
        fmData,
        "featureModels",
        "feature-model configs"
      ).map((row) => ({
        id: String(row.id),
        tool_key: String(row.tool_key),
        feature_key: String(row.feature_key),
        model_tier: String(row.model_tier),
        enabled: Boolean(row.enabled),
        is_default: Boolean(row.is_default),
        updated_at: row.updated_at ? String(row.updated_at) : undefined,
      }));
      const modelConfigs = requireAdminConfigRows(modelsData, "models", "model configs").map(
        (row) => ({
          id: String(row.id),
          tool_key: String(row.tool_key),
          config_key: String(row.config_key),
          provider: String(row.provider ?? ""),
          model: String(row.model ?? ""),
          enabled: Boolean(row.enabled),
        })
      );

      const modelCatalog = requireAdminConfigRows(
        catalogData,
        "modelCatalog",
        "model catalog"
      ).map((row) => ({
        id: String(row.id),
        tool_key: String(row.tool_key),
        model_id: String(row.model_id),
        enabled: Boolean(row.enabled),
        updated_at: row.updated_at ? String(row.updated_at) : undefined,
        archived_at: row.archived_at ? String(row.archived_at) : null,
      }));

      const tree = buildAdminConfigTree({
        tools: toolConfigs,
        pricing,
        featureModels,
        modelCatalog,
        modelConfigs,
        billingSettings: settings,
      });
      // A refresh keeps every unsaved price draft; only clean rows take the server values (#484).
      const merged = keepPricingDrafts(tree, toolsRef.current, savedPricingRef.current);
      setBillingSettings(settings);
      setTools(merged);
      toolsRef.current = merged;
      setSavedPricing(collectPricingBaselines(tree));
    } catch (e) {
      // A failed refresh must not wipe unsaved drafts either: keep the current tree and show the error.
      if (!hasUnsavedPricing(toolsRef.current, savedPricingRef.current)) {
        setBillingSettings(DEFAULT_BILLING_SETTINGS);
        setTools([]);
        toolsRef.current = [];
        setSavedPricing({});
      }
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

  const onProviderSwitched = useCallback((configKey: string, provider: PhotoProviderId) => {
    setTools((prev) => {
      const next = prev.map((t) => ({
        ...t,
        models: t.models.map((m) =>
          m.providerChoice?.configKey === configKey
            ? { ...m, providerChoice: { ...m.providerChoice, provider } }
            : m
        ),
      }));
      toolsRef.current = next;
      return next;
    });
    showToast({ type: "success", message: `Switched to ${PROVIDER_LABEL[provider]}.` });
  }, [showToast]);

  const setNotice = useCallback((modelId: string, reasons: string[] | null) => {
    setModelNotices((prev) => {
      const next = { ...prev };
      if (reasons && reasons.length > 0) next[modelId] = reasons;
      else delete next[modelId];
      return next;
    });
  }, []);

  // Tree updates from a server row: keeps the compare-and-set token (updated_at) and the removed flag current,
  // so a removed model leaves its tool's model list (and an added one appears) without a reload.
  const applyCatalogRow = useCallback((row: CatalogRow) => {
    setTools((prev) => {
      const next = prev.map((t) => ({
        ...t,
        models: t.models.map((m) =>
          m.catalogConfigId === row.id
            ? {
                ...m,
                enabled: row.enabled,
                catalogUpdatedAt: row.updated_at,
                ...(row.archived_at !== undefined ? { archived: !!row.archived_at } : {}),
              }
            : m
        ),
      }));
      toolsRef.current = next;
      return next;
    });
  }, []);

  const applyFeatureRow = useCallback(
    (row: { id: string; enabled: boolean; is_default: boolean; updated_at: string }) => {
      setTools((prev) => {
        const next = prev.map((t) => ({
          ...t,
          models: t.models.map((m) => ({
            ...m,
            features: m.features.map((f) =>
              f.featureModelId === row.id
                ? { ...f, enabled: row.enabled, isDefault: row.is_default, updatedAt: row.updated_at }
                : f
            ),
          })),
        }));
        toolsRef.current = next;
        return next;
      });
    },
    []
  );

  // Other rows' tokens may have moved (setting a default clears the old one): resync once the
  // autosave batch has settled.
  const resyncSoon = useCallback(() => {
    setTimeout(() => {
      void load(true);
    }, 500);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          coming_soon: overrides.comingSoon ?? tool.comingSoon,
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
          display_name: live.label,
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
          display_name: live.label,
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

  /** A refused catalog change (409): roll the row back to the server's copy and say why next to the model. */
  const catalogRefusal = useCallback(
    (modelId: string, e: unknown): Error => {
      if (!(e instanceof AdminApiError) || e.status !== 409) return e instanceof Error ? e : new Error("Failed to save.");
      const current = e.body.modelCatalog as CatalogRow | null;
      if (current) applyCatalogRow(current);
      const reasons =
        e.body.code === "STALE_MODEL_CONFIG"
          ? [STALE_MODEL_MESSAGE]
          : e.body.code === "MIGRATION_REQUIRED"
            ? ["This needs migration 118. Ask a developer to apply it."]
            : ((e.body.reasons as string[] | undefined) ?? [e.message]);
      // One short sentence at the moment of action: the first (highest-priority) guard reason.
      setNotice(modelId, reasons.slice(0, 1));
      if (e.body.code === "STALE_MODEL_CONFIG") resyncSoon();
      return new Error(reasons[0]);
    },
    [applyCatalogRow, setNotice, resyncSoon]
  );

  const commitModelCatalog = useCallback(
    (modelId: string, enabled: boolean) => {
      catalogPendingRef.current.set(modelId, enabled);
      setNotice(modelId, null);
      scheduleAutosave(`catalog:${modelId}`, async () => {
        do {
          const live = toolsRef.current.flatMap((t) => t.models).find((m) => m.id === modelId);
          if (!live?.catalogConfigId || !live.catalogUpdatedAt) {
            throw new Error("Catalog row missing — click Refresh, then try again.");
          }
          const targetEnabled = catalogPendingRef.current.get(modelId);
          if (targetEnabled === undefined) {
            throw new Error("Catalog save cancelled — toggle On again.");
          }
          try {
            const data = await patchApi(`/api/admin/config/model-catalog/${live.catalogConfigId}`, {
              enabled: targetEnabled,
              expectedUpdatedAt: live.catalogUpdatedAt,
            });
            applyCatalogRow(data.modelCatalog as CatalogRow);
          } catch (e) {
            catalogPendingRef.current.delete(modelId);
            // A refusal rolls the optimistic toggle back to the server's row and says why.
            throw catalogRefusal(modelId, e);
          }
          if (catalogPendingRef.current.get(modelId) === targetEnabled) break;
        } while (true);
        catalogPendingRef.current.delete(modelId);
      });
    },
    [scheduleAutosave, setNotice, applyCatalogRow, catalogRefusal]
  );

  /** The model's current catalog row (id + compare-and-set token), read at save time. */
  const liveCatalogModel = useCallback((modelId: string) => {
    const live = toolsRef.current.flatMap((t) => t.models).find((m) => m.id === modelId);
    if (!live?.catalogConfigId || !live.catalogUpdatedAt) {
      throw new Error("Model settings are not ready. Click Refresh, then try again.");
    }
    return { ...live, catalogConfigId: live.catalogConfigId, catalogUpdatedAt: live.catalogUpdatedAt };
  }, []);

  // Remove = archive this tool's catalog row (guarded server-side). Same autosave key as the
  // on/off switch, so the two never race on the compare-and-set token.
  const removeModel = useCallback(
    (modelId: string) => {
      setNotice(modelId, null);
      scheduleAutosave(`catalog:${modelId}`, async () => {
        const live = liveCatalogModel(modelId);
        try {
          const data = await postApi(`/api/admin/config/model-catalog/${live.catalogConfigId}/archive`, {
            expectedUpdatedAt: live.catalogUpdatedAt,
          });
          applyCatalogRow(data.modelCatalog as CatalogRow);
        } catch (e) {
          throw catalogRefusal(modelId, e);
        }
      });
    },
    [scheduleAutosave, setNotice, applyCatalogRow, catalogRefusal, liveCatalogModel]
  );

  // Add = restore (when removed) then turn on; the enable step re-runs the price/provider guard.
  const addModel = useCallback(
    (modelId: string) => {
      setNotice(modelId, null);
      scheduleAutosave(`catalog:${modelId}`, async () => {
        const live = liveCatalogModel(modelId);
        try {
          let token = live.catalogUpdatedAt;
          if (live.archived) {
            const restored = await postApi(`/api/admin/config/model-catalog/${live.catalogConfigId}/restore`, {
              expectedUpdatedAt: token,
            });
            const row = restored.modelCatalog as CatalogRow;
            applyCatalogRow(row);
            token = row.updated_at;
          }
          const data = await patchApi(`/api/admin/config/model-catalog/${live.catalogConfigId}`, {
            enabled: true,
            expectedUpdatedAt: token,
          });
          applyCatalogRow(data.modelCatalog as CatalogRow);
        } catch (e) {
          throw catalogRefusal(modelId, e);
        }
      });
    },
    [scheduleAutosave, setNotice, applyCatalogRow, catalogRefusal, liveCatalogModel]
  );

  const commitFeatureMode = useCallback(
    (featureModelId: string) => {
      scheduleAutosave(`fm:${featureModelId || "missing"}`, async () => {
        if (!featureModelId) {
          throw new Error("Mode row missing — click Refresh, then try again.");
        }
        const feature = findFeatureByModelId(toolsRef.current, featureModelId);
        if (!feature?.featureModelId || !feature.updatedAt) {
          throw new Error("Mode row missing — click Refresh, then try again.");
        }
        const owner = toolsRef.current.flatMap((t) => t.models).find((m) => m.features.some((f) => f.featureModelId === featureModelId));
        if (owner) setNotice(owner.id, null);
        try {
          const data = await patchApi(`/api/admin/config/feature-models/${featureModelId}`, {
            enabled: feature.enabled,
            is_default: feature.isDefault,
            expectedUpdatedAt: feature.updatedAt,
          });
          applyFeatureRow(data.featureModel as { id: string; enabled: boolean; is_default: boolean; updated_at: string });
          if (feature.isDefault) resyncSoon();
        } catch (e) {
          if (e instanceof AdminApiError && e.status === 409) {
            const current = e.body.featureModel as { id: string; enabled: boolean; is_default: boolean; updated_at: string } | null;
            if (current) applyFeatureRow(current);
            const stale = e.body.code === "STALE_MODEL_CONFIG";
            const reasons = stale ? [STALE_MODEL_MESSAGE] : ((e.body.reasons as string[] | undefined) ?? [e.message]);
            if (owner) setNotice(owner.id, reasons);
            if (stale) resyncSoon();
            throw new Error(reasons.join(" "));
          }
          throw e;
        }
      });
    },
    [scheduleAutosave, setNotice, applyFeatureRow, resyncSoon]
  );

  const unsaved = hasUnsavedPricing(tools, savedPricing);
  const backGuardRef = useRef<BackGuardState>({ base: null, leaving: false, dropping: false });
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // In-app links (admin tabs, sidebar) unmount this provider and its drafts: ask first.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || CATALOG_PATHS.some((p) => url.pathname.startsWith(p))) return;
      if (!window.confirm(UNSAVED_LEAVE_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Browser Back (#484): park one same-URL entry on top of the current one, which gets a unique stamp.
    // Landing back on the stamped entry means "leave": ask first. Stay steps forward onto the parked entry
    // again (whatever tool it shows now); leave steps back once more. Next keeps custom history state on
    // back/forward, so the stamp survives. Scroll restoration is manual while guarded so stepping between
    // the two same-URL entries never jumps the page.
    const g = backGuardRef.current;
    window.history.scrollRestoration = "manual";
    if (!g.dropping && !(g.base && window.history.state?.[BACK_GUARD_KEY] === g.base)) parkBackGuard(g);
    const onPopState = (e: PopStateEvent) => {
      if (g.dropping) return;
      if (g.leaving) {
        // Still on an older guard entry of this page: keep stepping back. Landed on another catalog tab
        // (drafts survive there): guard again from here. Anywhere else this provider is about to unmount.
        if (e.state?.[BACK_BASE_KEY] || e.state?.[BACK_GUARD_KEY]) {
          window.history.back();
          return;
        }
        g.leaving = false;
        if (CATALOG_PATHS.some((p) => window.location.pathname.startsWith(p))) parkBackGuard(g);
        return;
      }
      if (!g.base || e.state?.[BACK_BASE_KEY] !== g.base) return;
      if (window.confirm(UNSAVED_LEAVE_MESSAGE)) {
        g.leaving = true;
        window.history.back();
      } else {
        window.history.forward();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      window.history.scrollRestoration = "auto";
    };
  }, [unsaved]);
  // Once everything is saved, step back off the parked entry so Back is not a dead press. Runs only while
  // mounted (never on unmount) and only when the parked entry is still the current one. That step's own
  // popstate is ignored, and if a draft appeared meanwhile the guard is parked again once it lands.
  const wasUnsavedRef = useRef(false);
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  useEffect(() => {
    const g = backGuardRef.current;
    if (wasUnsavedRef.current && !unsaved && g.base && window.history.state?.[BACK_GUARD_KEY] === g.base) {
      g.dropping = true;
      window.history.scrollRestoration = "manual";
      const onDropped = () => {
        window.removeEventListener("popstate", onDropped);
        g.dropping = false;
        g.base = null;
        if (unsavedRef.current) parkBackGuard(g);
        else window.history.scrollRestoration = "auto";
      };
      window.addEventListener("popstate", onDropped);
      window.history.back();
    }
    wasUnsavedRef.current = unsaved;
  }, [unsaved]);

  if (loading) {
    return pathname?.startsWith(MODELS_PATH) ? <AdminModelsSkeleton /> : <AdminConfigSkeleton />;
  }

  return (
    <CatalogContext.Provider
      value={{
        tools,
        billingSettings,
        saving,
        savedPricing,
        patchTool,
        commitTool,
        saveVariant,
        toggleVariant,
        commitFeatureMode,
        commitModelCatalog,
        commitPipelineRole,
        removeModel,
        addModel,
        modelsTool,
        setModelsTool,
        featureFilters,
        setFeatureFilter,
      }}
    >
    <ModelNoticeContext.Provider value={modelNotices}>
    <ProviderAdminContext.Provider value={{ falConfigured, costs: providerCosts, sellIdrPerCredit, onSwitched: onProviderSwitched }}>
      {toast ? <AdminToast toast={toast} onDismiss={dismiss} /> : null}
      <div className="mx-auto max-w-5xl space-y-3">
      <div className="flex items-center justify-end">
        <button type="button" onClick={() => void load()} className="text-xs text-gray-400 hover:text-white">
          Refresh
        </button>
      </div>

      {loadError ? <p className="text-xs text-red-400">{loadError}</p> : null}

      {children}
      </div>
    </ProviderAdminContext.Provider>
    </ModelNoticeContext.Provider>
    </CatalogContext.Provider>
  );
}

/** Config tab: one flat row per tool (On / Sidebar / Coming soon), then Platform availability. */
export function AdminConfigView() {
  const { tools, patchTool, commitTool } = useCatalog();
  return (
    <div className="space-y-6">
      <div id="admin-config-tools" className="divide-y divide-white/10 rounded-lg border border-white/10">
        {tools.map((tool) => (
          <ToolRow
            key={tool.toolKey}
            tool={tool}
            onChange={(patch) => patchTool(tool.toolKey, patch)}
            onCommitTool={(fields) => commitTool(tool.toolKey, fields)}
          />
        ))}
      </div>
      {/* Platform availability (see CONTEXT.md) is product-wide, not tool-scoped, with its own
          self-contained fetch/save rather than the tool autosave machinery. */}
      <PlatformAvailabilitySection />
    </div>
  );
}

/** Models tab: pick a tool, then its models with price, On/Off, Remove and Restore model (#466). */
export function AdminModelsView() {
  const catalog = useCatalog();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabTools = modelsTabTools(catalog.tools);
  // The selected tool is in the URL (?tool=photo), so a refresh or a bookmark keeps it.
  const requested = searchParams.get("tool") ?? catalog.modelsTool;
  const tool = tabTools.find((t) => t.toolKey === requested) ?? tabTools[0];
  const shownKey = tool?.toolKey;
  const urlKey = searchParams.get("tool");
  useEffect(() => {
    // Arriving from the nav link (no ?tool) or with an unknown tool: write the shown tool into the URL.
    if (shownKey && urlKey !== shownKey) {
      router.replace(`${pathname}?tool=${encodeURIComponent(shownKey)}`, { scroll: false });
    }
  }, [shownKey, urlKey, pathname, router]);

  if (!tool) return <p className="text-sm text-gray-500">No tool has models yet.</p>;

  const select = (toolKey: string) => {
    catalog.setModelsTool(toolKey);
    router.replace(`${pathname}?tool=${encodeURIComponent(toolKey)}`, { scroll: false });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tool">
        {tabTools.map((t) => {
          const active = t.toolKey === tool.toolKey;
          const unsaved = hasUnsavedPricing([t], catalog.savedPricing);
          return (
            <button
              key={t.toolKey}
              type="button"
              aria-pressed={active}
              onClick={() => select(t.toolKey)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "border-white/30 bg-white/[0.08] text-white"
                  : "border-white/10 text-gray-400 hover:border-white/20 hover:text-white"
              }`}
            >
              {t.label}
              {unsaved ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden />
                  <span className="sr-only">(unsaved price changes)</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
      <ToolModels
        key={tool.toolKey}
        tool={tool}
        billingSettings={catalog.billingSettings}
        saving={catalog.saving}
        savedPricing={catalog.savedPricing}
        onChange={(patch) => catalog.patchTool(tool.toolKey, patch)}
        onSaveVariant={catalog.saveVariant}
        onToggleVariant={catalog.toggleVariant}
        onCommitMode={catalog.commitFeatureMode}
        onCommitCatalog={catalog.commitModelCatalog}
        onCommitPipelineRole={catalog.commitPipelineRole}
        onRemoveModel={catalog.removeModel}
        onAddModel={catalog.addModel}
        featureFilter={catalog.featureFilters[tool.toolKey] ?? "all"}
        onFeatureFilterChange={(featureKey) => catalog.setFeatureFilter(tool.toolKey, featureKey)}
      />
    </div>
  );
}
