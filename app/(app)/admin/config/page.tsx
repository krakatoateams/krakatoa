"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  type BillingSettings,
  type CostUnit,
  DEFAULT_BILLING_SETTINGS,
  calculateCredits,
  normalizeBillingSettings,
} from "@/lib/pricing-math";
import { PRODUCT_PHOTO_TIERS } from "@/lib/product-photo";
import { PHOTO_FEATURES } from "@/lib/creation-features";

type ToolConfig = {
  tool_key: string;
  display_name: string;
  enabled: boolean;
  visible_in_sidebar: boolean;
  sort_order: number;
};

type PricingConfig = {
  pricing_key: string;
  display_name: string;
  pricing_type: "fixed" | "per_second" | "per_image";
  credit_amount: number;
  enabled: boolean;
  // Pricing Config v2.1.
  provider_cost_usd: number | null;
  cost_unit: CostUnit | null;
  pricing_group: string | null;
  variant_key: string | null;
  currency: string;
  // Pricing Config v2.2 soft-deprecation flag.
  is_deprecated: boolean;
};

type ModelConfig = {
  id: string;
  tool_key: string;
  config_key: string;
  provider: string;
  model: string;
  enabled: boolean;
  is_default: boolean;
};

type FeatureModelConfig = {
  id: string;
  tool_key: string;
  feature_key: string;
  model_tier: string;
  enabled: boolean;
  is_default: boolean;
  sort_order: number;
};

type Tab = "tools" | "pricing" | "models";

// Friendly labels for the Models tree (creation type → feature → models).
const TIER_LABEL: Record<string, string> = Object.fromEntries(
  PRODUCT_PHOTO_TIERS.map((t) => [t.id, t.modelLabel])
);
const TIER_SUBTITLE: Record<string, string> = Object.fromEntries(
  PRODUCT_PHOTO_TIERS.map((t) => [t.id, t.providerModel])
);
const PHOTO_FEATURE_LABEL: Record<string, string> = Object.fromEntries(
  PHOTO_FEATURES.map((f) => [f.key, f.label])
);
const PHOTO_FEATURE_DESC: Record<string, string> = Object.fromEntries(
  PHOTO_FEATURES.map((f) => [f.key, f.description])
);
const PHOTO_FEATURE_ORDER = PHOTO_FEATURES.map((f) => f.key);

// model_configs rows grouped under a creation type + feature label for the tree.
const MODEL_CONFIG_GROUP: Record<string, { type: string; feature: string; order: number }> = {
  reels: { type: "Reels", feature: "ReelsGen pipeline", order: 0 },
  veo: { type: "Reels", feature: "Veo pipeline", order: 1 },
  storyboard: { type: "Reels", feature: "Storyboard pipeline", order: 2 },
  photo: { type: "Photo", feature: "Model definitions (provider / model)", order: 3 },
  render: { type: "Other", feature: "Rendering", order: 4 },
};

const SAVE_NOTICE = "Saved. Runtime may update within ~60 seconds.";
const RESET_NOTICE = "Reset to default. Runtime may update within ~60 seconds.";

const CREDIT_AMOUNT_MAX = 100_000;

const TH =
  "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500";
const INPUT =
  "w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-white outline-none focus:border-violet-500";

type BadgeTone = "active" | "disabled" | "invalid";

const BADGE_TONES: Record<BadgeTone, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  disabled: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  invalid: "border-red-500/30 bg-red-500/10 text-red-300",
};

function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

// ---- Effective-status helpers (client-side mirror of resolver behavior). ----
// These are advisory only. The server validators + resolvers are authoritative.

/** A v2 row prices from the provider cost when it has a numeric cost + a cost unit. */
function isV2Row(p: PricingConfig): boolean {
  return typeof p.provider_cost_usd === "number" && p.cost_unit !== null;
}

/** A primary runtime pricing row: a non-deprecated v2 provider-cost row. */
function isPrimaryRow(p: PricingConfig): boolean {
  return !p.is_deprecated && isV2Row(p);
}

/** Platform/global credit setting (e.g. initial_dummy_credits): not a provider cost. */
function isPlatformRow(p: PricingConfig): boolean {
  return !p.is_deprecated && !isV2Row(p);
}

// ---- Visual grouping (admin skim-ability). Groups the primary pricing rows by
// pricing_group so the long list reads as labeled sections instead of one dump. ----

const PRICING_GROUP_LABELS: Record<string, string> = {
  product_photo: "Product Photo",
  seedance: "ReelsGen / Seedance",
  seedance2: "Seedance 2",
  seedance2mini: "Seedance 2 Mini",
  seedance15: "Seedance 1.5 Pro",
  seedance1fast: "Seedance 1 Pro Fast",
  seedance1pro: "Seedance 1 Pro",
  seedance1lite: "Seedance 1 Lite",
  kling3: "Kling v3",
  kling3omni: "Kling v3 Omni",
  kling15: "Kling v1.5",
  kling16: "Kling v1.6",
  kling21: "Kling v2.1",
  kling25turbo: "Kling v2.5 Turbo Pro",
  kling26: "Kling v2.6",
  kling3mc: "Kling v3 Motion Control",
  kling26mc: "Kling v2.6 Motion Control",
  veo: "Veo",
  storyboard_image: "Storyboard Image",
  storyboard: "Storyboard",
};

// Preferred section order; anything unknown falls to the end, alphabetized.
const PRICING_GROUP_ORDER = [
  "product_photo",
  "seedance",
  "seedance2",
  "seedance2mini",
  "seedance15",
  "seedance1fast",
  "seedance1pro",
  "seedance1lite",
  "kling3",
  "kling3omni",
  "kling15",
  "kling16",
  "kling21",
  "kling25turbo",
  "kling26",
  "kling3mc",
  "kling26mc",
  "veo",
  "storyboard_image",
  "storyboard",
];

function pricingGroupLabel(group: string | null): string {
  if (!group) return "Other";
  return (
    PRICING_GROUP_LABELS[group] ??
    group.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// The group-name prefix baked into each row's display_name (e.g. "Seedance 480p
// (per sec)"). Stripped in the grouped table since the section header already
// shows it — DB display_name is unchanged.
const PRICING_GROUP_NAME_PREFIX: Record<string, string> = {
  product_photo: "Product Photo",
  seedance: "Seedance",
  seedance2: "Seedance 2",
  seedance2mini: "Seedance 2 Mini",
  seedance15: "Seedance 1.5 Pro",
  seedance1fast: "Seedance 1 Pro Fast",
  seedance1pro: "Seedance 1 Pro",
  seedance1lite: "Seedance 1 Lite",
  kling3: "Kling v3",
  kling3omni: "Kling v3 Omni",
  kling15: "Kling v1.5",
  kling16: "Kling v1.6",
  kling21: "Kling v2.1",
  kling25turbo: "Kling v2.5 Turbo Pro",
  kling26: "Kling v2.6",
  kling3mc: "Kling v3 Motion Control",
  kling26mc: "Kling v2.6 Motion Control",
  veo: "Veo",
  storyboard_image: "Storyboard Image",
  storyboard: "Storyboard",
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove the redundant group-name prefix from a row title (group is in the header). */
function stripGroupPrefix(displayName: string, groupKey: string): string {
  const prefix = PRICING_GROUP_NAME_PREFIX[groupKey];
  if (!prefix) return displayName;
  const re = new RegExp(`^${escapeRegExp(prefix)}\\s*[—–:·-]?\\s*`, "i");
  const stripped = displayName.replace(re, "").trim();
  return stripped.length > 0 ? stripped : displayName;
}

type PricingGroupSection = { key: string; label: string; rows: PricingConfig[] };

/** Group primary rows by pricing_group, ordered for skimming; rows sorted cheap→expensive. */
function groupPrimaryRows(rows: PricingConfig[]): PricingGroupSection[] {
  const byGroup = new Map<string, PricingConfig[]>();
  for (const r of rows) {
    const g = r.pricing_group ?? "other";
    const list = byGroup.get(g);
    if (list) list.push(r);
    else byGroup.set(g, [r]);
  }
  for (const list of Array.from(byGroup.values())) {
    list.sort(
      (a, b) =>
        (a.provider_cost_usd ?? 0) - (b.provider_cost_usd ?? 0) ||
        a.display_name.localeCompare(b.display_name)
    );
  }
  const rank = (g: string) => {
    const i = PRICING_GROUP_ORDER.indexOf(g);
    return i === -1 ? PRICING_GROUP_ORDER.length : i;
  };
  return Array.from(byGroup.keys())
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((key) => ({ key, label: pricingGroupLabel(key), rows: byGroup.get(key)! }));
}

// Status for a PRIMARY v2 row. v2.2: disabling a row reverts runtime to the
// built-in v2 default (correct provider cost) — it never undercharges/frees.
function pricingStatus(p: PricingConfig): { tone: BadgeTone; label: string } {
  if (!p.enabled) return { tone: "disabled", label: "Disabled — built-in v2 default used" };
  if (typeof p.provider_cost_usd !== "number" || p.provider_cost_usd < 0)
    return { tone: "invalid", label: "Invalid cost — built-in v2 default used" };
  return { tone: "active", label: "Runtime active (provider cost)" };
}

function pricingWarning(p: PricingConfig): string | null {
  if (p.provider_cost_usd === 0) {
    return "Provider cost 0 — this tier computes to 0 credits (free).";
  }
  return null;
}

const COST_UNIT_LABEL: Record<CostUnit, string> = {
  per_image: "image",
  per_second: "sec",
  per_run: "run",
  per_1k_tokens: "1k tokens",
};

/**
 * Computed-credits preview for a single unit using the current billing settings.
 * Mirrors lib/pricing-math.ts. For per_second this is the per-second equivalent;
 * the real charge totals the duration first, then ceils once.
 */
function computedPreview(p: PricingConfig, settings: BillingSettings): string {
  if (typeof p.provider_cost_usd !== "number") return "—";
  const credits = calculateCredits({ providerCostUsd: p.provider_cost_usd, unitCount: 1, settings });
  const unit = p.cost_unit ? COST_UNIT_LABEL[p.cost_unit] : "unit";
  return `${credits} cr / ${unit}`;
}

function modelStatus(m: ModelConfig): { tone: BadgeTone; label: string } {
  if (!m.enabled) return { tone: "disabled", label: "Disabled — fallback/default used" };
  if (m.provider.trim() === "" || m.model.trim() === "")
    return { tone: "invalid", label: "Invalid — fallback/default used" };
  return { tone: "active", label: "Runtime active" };
}

function modelWarning(m: ModelConfig): string | null {
  if (m.model.trim() === "") return null; // covered by the Invalid badge
  if (/\s/.test(m.model)) return "Whitespace in model id — may break runtime generation.";
  if (m.provider.trim() === "replicate" && !m.model.includes("/"))
    return 'Expected "owner/name" for a Replicate model — a typo can break generation.';
  return null;
}

function toolStatus(t: ToolConfig): { tone: BadgeTone; label: string } {
  return t.enabled
    ? { tone: "active", label: "Runtime active" }
    : { tone: "disabled", label: "Disabled — generation blocked" };
}

function NoteBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3 text-xs leading-relaxed text-gray-400">
      {children}
    </div>
  );
}

function RowButtons({
  busy,
  onSave,
  onReset,
}: {
  busy: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        className="rounded-md bg-violet-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={busy}
        className="rounded-md border border-gray-700 bg-gray-900 px-3 py-1 text-xs font-semibold text-gray-300 transition-colors hover:border-gray-500 hover:text-white disabled:opacity-50"
      >
        Reset
      </button>
    </div>
  );
}

export default function AdminConfigPage() {
  const [tab, setTab] = useState<Tab>("tools");
  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [pricing, setPricing] = useState<PricingConfig[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [featureModels, setFeatureModels] = useState<FeatureModelConfig[]>([]);
  const [billingSettings, setBillingSettings] = useState<BillingSettings>(DEFAULT_BILLING_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [apiWarnings, setApiWarnings] = useState<string[]>([]);
  const [showDeprecated, setShowDeprecated] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/config/tools").then((r) => r.json()),
      fetch("/api/admin/config/pricing").then((r) => r.json()),
      fetch("/api/admin/config/models").then((r) => r.json()),
      // Billing settings are read-only here; sourced from the shared pricing API
      // (any authenticated user, incl. admins, may read it). Editing billing
      // settings is a tracked follow-up (no admin write endpoint yet).
      fetch("/api/credits/pricing")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      // Per-feature model enablement. Resolves even on error (e.g. before the
      // 012 migration) so the rest of the panel still loads.
      fetch("/api/admin/config/feature-models")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([t, p, m, pr, fm]) => {
        setTools(t.tools ?? []);
        setFeatureModels((fm?.featureModels ?? []) as FeatureModelConfig[]);
        // Coerce provider_cost_usd: PostgREST may serialize `numeric` as a string.
        setPricing(
          ((p.pricing ?? []) as PricingConfig[]).map((row) => ({
            ...row,
            provider_cost_usd:
              row.provider_cost_usd === null || row.provider_cost_usd === undefined
                ? null
                : Number(row.provider_cost_usd),
            is_deprecated: Boolean(row.is_deprecated),
          }))
        );
        setModels(m.models ?? []);
        setBillingSettings(normalizeBillingSettings(pr?.billingSettings));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (url: string, body: Record<string, unknown>) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    setApiWarnings([]);
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setNotice(SAVE_NOTICE);
      if (Array.isArray(data.warnings)) setApiWarnings(data.warnings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setBusy(false);
    }
  };

  const resetRow = async (url: string, label: string) => {
    if (!window.confirm(`Reset "${label}" to its default value?`)) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    setApiWarnings([]);
    try {
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setNotice(RESET_NOTICE);
      if (Array.isArray(data.warnings)) setApiWarnings(data.warnings);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reset.");
    } finally {
      setBusy(false);
    }
  };

  const setToolField = (key: string, field: keyof ToolConfig, value: unknown) =>
    setTools((prev) => prev.map((t) => (t.tool_key === key ? { ...t, [field]: value } : t)));
  const setPricingField = (key: string, field: keyof PricingConfig, value: unknown) =>
    setPricing((prev) =>
      prev.map((p) => (p.pricing_key === key ? { ...p, [field]: value } : p))
    );
  const setModelField = (id: string, field: keyof ModelConfig, value: unknown) =>
    setModels((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)));
  const setFeatureModelEnabled = (id: string, value: boolean) =>
    setFeatureModels((prev) => prev.map((f) => (f.id === id ? { ...f, enabled: value } : f)));
  // Default is exclusive per (tool_key, feature_key): selecting one clears siblings
  // locally (the server enforces the same on save).
  const setFeatureModelDefault = (id: string, value: boolean) =>
    setFeatureModels((prev) => {
      const target = prev.find((f) => f.id === id);
      if (!target) return prev;
      return prev.map((f) => {
        if (f.id === id) return { ...f, is_default: value };
        if (value && f.tool_key === target.tool_key && f.feature_key === target.feature_key) {
          return { ...f, is_default: false };
        }
        return f;
      });
    });

  // --- Models tab render helpers (creation type → feature → models) ---

  // One editable model_configs row (provider/model/enable/default). Used by the
  // Reels pipeline + Photo model-definition sections.
  const renderModelConfigRow = (m: ModelConfig) => {
    const status = modelStatus(m);
    const warn = modelWarning(m);
    return (
      <tr key={m.id} className="text-sm text-gray-300">
        <td className="px-3 py-2">
          <div className="font-medium text-white">{m.config_key}</div>
          <div className="text-xs text-gray-500">{m.tool_key}</div>
        </td>
        <td className="px-3 py-2">
          <Badge tone={status.tone}>{status.label}</Badge>
        </td>
        <td className="px-3 py-2 w-32">
          <input
            value={m.provider}
            onChange={(e) => setModelField(m.id, "provider", e.target.value)}
            className={INPUT}
          />
        </td>
        <td className="px-3 py-2 min-w-64">
          <input
            value={m.model}
            onChange={(e) => setModelField(m.id, "model", e.target.value)}
            className={INPUT}
          />
          {warn ? <div className="mt-1 text-[11px] text-amber-300">⚠ {warn}</div> : null}
        </td>
        <td className="px-3 py-2">
          <input
            type="checkbox"
            checked={m.enabled}
            onChange={(e) => setModelField(m.id, "enabled", e.target.checked)}
          />
        </td>
        <td className="px-3 py-2">
          <input
            type="checkbox"
            checked={m.is_default}
            onChange={(e) => setModelField(m.id, "is_default", e.target.checked)}
          />
        </td>
        <td className="px-3 py-2 text-right">
          <RowButtons
            busy={busy}
            onSave={() =>
              patch(`/api/admin/config/models/${m.id}`, {
                provider: m.provider,
                model: m.model,
                enabled: m.enabled,
                is_default: m.is_default,
              })
            }
            onReset={() =>
              resetRow(`/api/admin/config/models/${m.id}/reset`, `${m.tool_key}/${m.config_key}`)
            }
          />
        </td>
      </tr>
    );
  };

  const renderModelConfigTable = (rows: ModelConfig[]) => (
    <div className="overflow-x-auto rounded-xl border border-gray-800">
      <table className="w-full">
        <thead className="bg-gray-900/60">
          <tr>
            <th className={TH}>Config key</th>
            <th className={TH}>Status</th>
            <th className={TH}>Provider</th>
            <th className={TH}>Model</th>
            <th className={TH}>Enabled</th>
            <th className={TH}>Default</th>
            <th className={TH}></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">{rows.map(renderModelConfigRow)}</tbody>
      </table>
    </div>
  );

  // One per-feature enablement row (which Photo model is offered for a feature).
  const renderFeatureModelTable = (featureKey: string) => {
    const rows = featureModels
      .filter((f) => f.tool_key === "photo" && f.feature_key === featureKey)
      .sort((a, b) => a.sort_order - b.sort_order || a.model_tier.localeCompare(b.model_tier));
    if (rows.length === 0) {
      return (
        <p className="rounded-lg border border-dashed border-gray-800 px-4 py-3 text-xs text-gray-500">
          No models materialized yet. Apply migration 012, then reload.
        </p>
      );
    }
    return (
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full">
          <thead className="bg-gray-900/60">
            <tr>
              <th className={TH}>Model</th>
              <th className={TH}>Status</th>
              <th className={TH}>Enabled</th>
              <th className={TH}>Default</th>
              <th className={TH}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {rows.map((f) => (
              <tr key={f.id} className="text-sm text-gray-300">
                <td className="px-3 py-2">
                  <div className="font-medium text-white">
                    {TIER_LABEL[f.model_tier] ?? f.model_tier}
                  </div>
                  <div className="text-xs text-gray-500">
                    {TIER_SUBTITLE[f.model_tier] ?? f.model_tier}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={f.enabled ? "active" : "disabled"}>
                    {f.enabled ? "Offered" : "Hidden from this feature"}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={f.enabled}
                    onChange={(e) => setFeatureModelEnabled(f.id, e.target.checked)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="radio"
                    name={`default-${f.tool_key}-${f.feature_key}`}
                    checked={f.is_default}
                    disabled={!f.enabled}
                    onChange={(e) => setFeatureModelDefault(f.id, e.target.checked)}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <RowButtons
                    busy={busy}
                    onSave={() =>
                      patch(`/api/admin/config/feature-models/${f.id}`, {
                        enabled: f.enabled,
                        is_default: f.is_default,
                      })
                    }
                    onReset={() =>
                      resetRow(
                        `/api/admin/config/feature-models/${f.id}/reset`,
                        `${PHOTO_FEATURE_LABEL[f.feature_key] ?? f.feature_key} · ${
                          TIER_LABEL[f.model_tier] ?? f.model_tier
                        }`
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
        <p className="font-semibold text-amber-100">Changes here affect live generation.</p>
        <ul className="ml-4 list-disc space-y-0.5">
          <li>Pricing and model changes affect new generations.</li>
          <li>Changes may take up to 60 seconds to apply due to a runtime cache.</li>
          <li>Invalid model IDs can cause generation failures.</li>
          <li>API keys are not stored here; secrets remain in environment variables.</li>
        </ul>
      </div>

      <div className="flex gap-1 border-b border-gray-800">
        {(["tools", "pricing", "models"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t
                ? "border-violet-500 text-violet-300"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {notice ? <p className="text-sm text-emerald-400">{notice}</p> : null}
      {apiWarnings.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-amber-300">
          {apiWarnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {loading ? <p className="text-sm text-gray-500">Loading config…</p> : null}

      {!loading && tab === "tools" ? (
        <div className="space-y-3">
          <NoteBox>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>
                <span className="font-mono text-gray-300">enabled=false</span> blocks the mapped
                generation API routes (not just the UI).
              </li>
              <li>
                <span className="font-mono text-gray-300">visible_in_sidebar</span> only hides the
                sidebar link; it does not block routes.
              </li>
              <li>Veo and Storyboard currently share the ReelsGen (reels) runtime flag.</li>
            </ul>
          </NoteBox>
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full">
              <thead className="bg-gray-900/60">
                <tr>
                  <th className={TH}>Tool</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Enabled</th>
                  <th className={TH}>Visible in sidebar</th>
                  <th className={TH}>Sort</th>
                  <th className={TH}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {tools.map((t) => {
                  const status = toolStatus(t);
                  return (
                    <tr key={t.tool_key} className="text-sm text-gray-300">
                      <td className="px-3 py-2">
                        <div className="font-medium text-white">{t.display_name}</div>
                        <div className="text-xs text-gray-500">{t.tool_key}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={t.enabled}
                          onChange={(e) => setToolField(t.tool_key, "enabled", e.target.checked)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={t.visible_in_sidebar}
                          onChange={(e) =>
                            setToolField(t.tool_key, "visible_in_sidebar", e.target.checked)
                          }
                        />
                      </td>
                      <td className="px-3 py-2 w-20">
                        <input
                          type="number"
                          value={t.sort_order}
                          onChange={(e) =>
                            setToolField(t.tool_key, "sort_order", Number(e.target.value))
                          }
                          className={INPUT}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <RowButtons
                          busy={busy}
                          onSave={() =>
                            patch(`/api/admin/config/tools/${t.tool_key}`, {
                              enabled: t.enabled,
                              visible_in_sidebar: t.visible_in_sidebar,
                              sort_order: t.sort_order,
                            })
                          }
                          onReset={() =>
                            resetRow(
                              `/api/admin/config/tools/${t.tool_key}/reset`,
                              t.display_name
                            )
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!loading && tab === "pricing" ? (
        <div className="space-y-3">
          {/* Billing settings — read-only (Pricing Config v2.1). Editing is a
              tracked follow-up: there is no admin write endpoint yet. */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Billing settings</h3>
              <Badge tone="active">Read-only</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-gray-500">USD → IDR</div>
                <div className="font-mono text-sm text-white">{billingSettings.usdToIdr}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-gray-500">Credit value (IDR)</div>
                <div className="font-mono text-sm text-white">{billingSettings.creditValueIdr}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-gray-500">Margin multiplier</div>
                <div className="font-mono text-sm text-white">{billingSettings.marginMultiplier}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-gray-500">Rounding</div>
                <div className="font-mono text-sm text-white">{billingSettings.roundingMode}</div>
              </div>
            </div>
            <div className="mt-3 space-y-0.5 text-[11px] text-amber-300">
              <p>⚠ Margin {billingSettings.marginMultiplier} = internal testing (provider cost 1:1, no profit).</p>
              <p>⚠ Changing USD→IDR / credit value / margin affects all future generation costs.</p>
              <p>Rounding happens only at the final charge (single ceil; no per-second rounding).</p>
              <p>No payment / top-up UI here — this is pricing config only.</p>
            </div>
          </div>

          <NoteBox>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>
                <span className="font-mono text-gray-300">Provider USD</span> is the source of truth
                for runtime pricing — credits = cost × units via the billing settings above.
              </li>
              <li>
                If a row is disabled or its cost is blank, runtime uses the built-in v2 default cost
                (it never undercharges and never becomes free).
              </li>
              <li>
                <span className="font-mono text-gray-300">Computed</span> previews credits for one
                unit. Video totals the full duration first, then rounds once.
              </li>
            </ul>
          </NoteBox>
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full">
              <thead className="bg-gray-900/60">
                <tr>
                  <th className={TH}>Pricing key</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Provider USD</th>
                  <th className={TH}>Unit</th>
                  <th className={TH}>Computed</th>
                  <th className={TH}>Enabled</th>
                  <th className={TH}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {groupPrimaryRows(pricing.filter(isPrimaryRow)).map((section) => (
                  <Fragment key={`group-${section.key}`}>
                    <tr className="bg-gray-900/60">
                      <td colSpan={7} className="px-3 py-1.5">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-300">
                          {section.label}
                        </span>
                        <span className="ml-2 text-[11px] text-gray-500">
                          {section.rows.length}{" "}
                          {section.rows.length === 1 ? "variant" : "variants"}
                        </span>
                      </td>
                    </tr>
                    {section.rows.map((p) => {
                  const status = pricingStatus(p);
                  const warn = pricingWarning(p);
                  return (
                    <tr key={p.pricing_key} className="text-sm text-gray-300">
                      <td className="px-3 py-2">
                        <div className="font-medium text-white">
                          {stripGroupPrefix(p.display_name, section.key)}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="px-3 py-2 w-28">
                        <input
                          type="number"
                          min={0}
                          step={0.001}
                          value={p.provider_cost_usd ?? ""}
                          placeholder="—"
                          onChange={(e) =>
                            setPricingField(
                              p.pricing_key,
                              "provider_cost_usd",
                              e.target.value === "" ? null : Number(e.target.value)
                            )
                          }
                          className={INPUT}
                        />
                        {warn ? (
                          <div className="mt-1 text-[11px] text-amber-300">⚠ {warn}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-400">{p.cost_unit ?? "—"}</td>
                      <td className="px-3 py-2 text-xs font-mono text-emerald-300">
                        {computedPreview(p, billingSettings)}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={p.enabled}
                          onChange={(e) =>
                            setPricingField(p.pricing_key, "enabled", e.target.checked)
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <RowButtons
                          busy={busy}
                          onSave={() =>
                            patch(`/api/admin/config/pricing/${p.pricing_key}`, {
                              provider_cost_usd: p.provider_cost_usd,
                              enabled: p.enabled,
                            })
                          }
                          onReset={() =>
                            resetRow(
                              `/api/admin/config/pricing/${p.pricing_key}/reset`,
                              p.display_name
                            )
                          }
                        />
                      </td>
                    </tr>
                  );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Platform / global credit settings — NOT generation provider-cost rows.
              initial_dummy_credits is a credit GRANT, so credit_amount is its real
              value here (kept separate to avoid mixing with provider-cost pricing). */}
          {pricing.filter(isPlatformRow).length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-white">Platform credit settings</h3>
              <div className="overflow-x-auto rounded-xl border border-gray-800">
                <table className="w-full">
                  <thead className="bg-gray-900/60">
                    <tr>
                      <th className={TH}>Key</th>
                      <th className={TH}>Credit amount</th>
                      <th className={TH}>Enabled</th>
                      <th className={TH}></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {pricing.filter(isPlatformRow).map((p) => (
                      <tr key={p.pricing_key} className="text-sm text-gray-300">
                        <td className="px-3 py-2">
                          <div className="font-medium text-white">{p.display_name}</div>
                          <div className="text-xs text-gray-500">{p.pricing_key}</div>
                        </td>
                        <td className="px-3 py-2 w-28">
                          <input
                            type="number"
                            min={0}
                            max={CREDIT_AMOUNT_MAX}
                            value={p.credit_amount}
                            onChange={(e) =>
                              setPricingField(p.pricing_key, "credit_amount", Number(e.target.value))
                            }
                            className={INPUT}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={p.enabled}
                            onChange={(e) =>
                              setPricingField(p.pricing_key, "enabled", e.target.checked)
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <RowButtons
                            busy={busy}
                            onSave={() =>
                              patch(`/api/admin/config/pricing/${p.pricing_key}`, {
                                credit_amount: p.credit_amount,
                                enabled: p.enabled,
                              })
                            }
                            onReset={() =>
                              resetRow(
                                `/api/admin/config/pricing/${p.pricing_key}/reset`,
                                p.display_name
                              )
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Deprecated legacy rows — read-only, NOT runtime active. Kept for audit
              only; the resolver never reads them (it uses v2 rows + built-in v2
              defaults). Collapsed by default to keep the mental model clean. */}
          {pricing.filter((p) => p.is_deprecated).length > 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/30">
              <button
                type="button"
                onClick={() => setShowDeprecated((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-300">
                  Deprecated legacy rows
                  <Badge tone="disabled">Deprecated fallback only · not runtime active</Badge>
                </span>
                <span className="text-xs text-gray-500">{showDeprecated ? "Hide" : "Show"}</span>
              </button>
              {showDeprecated ? (
                <div className="overflow-x-auto border-t border-gray-800">
                  <table className="w-full">
                    <thead className="bg-gray-900/60">
                      <tr>
                        <th className={TH}>Pricing key</th>
                        <th className={TH}>Legacy amount</th>
                        <th className={TH}>State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {pricing
                        .filter((p) => p.is_deprecated)
                        .map((p) => (
                          <tr key={p.pricing_key} className="text-sm text-gray-400">
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-300">{p.display_name}</div>
                              <div className="text-xs text-gray-600">{p.pricing_key}</div>
                            </td>
                            <td className="px-3 py-2 font-mono text-gray-500">{p.credit_amount}</td>
                            <td className="px-3 py-2">
                              <Badge tone="disabled">Deprecated · disabled</Badge>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <p className="px-4 py-3 text-[11px] text-gray-500">
                    These rows are superseded by the provider-cost rows above and are never used as
                    runtime pricing. They are retained for history and are read-only.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && tab === "models" ? (
        <div className="space-y-8">
          <NoteBox>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>
                Models are organized by <span className="text-gray-300">creation type → feature</span>.
              </li>
              <li>
                Under <span className="text-gray-300">Photo</span>, each feature lists the models it
                can use. Toggle <span className="text-gray-300">Enabled</span> to offer/hide a model
                for that feature, and pick one <span className="text-gray-300">Default</span>.
                Disabling a model here hides it from that feature only.
              </li>
              <li>
                Reference-only models (text-to-image) never appear under Product try-on — that is a
                hard capability, not an admin toggle.
              </li>
              <li>
                Provider/model IDs (and the Whisper version pin in{" "}
                <span className="font-mono text-gray-300">parameters.version</span>) are edited in the
                model-definition tables. IDs must be exact; a typo can fail at generation time.
              </li>
              <li>Secrets / API keys are never stored here — they stay in environment variables.</li>
            </ul>
          </NoteBox>

          {/* ---- Photo creation type ---- */}
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-white">Photo</h2>
              <p className="text-xs text-gray-500">
                Image generation, product try-on, and character generation share one catalog of
                models. Enable models per feature below.
              </p>
            </div>

            {PHOTO_FEATURE_ORDER.map((fk) => (
              <div key={fk} className="space-y-2">
                <div>
                  <h3 className="text-sm font-semibold text-violet-300">
                    {PHOTO_FEATURE_LABEL[fk] ?? fk}
                  </h3>
                  <p className="text-[11px] text-gray-500">{PHOTO_FEATURE_DESC[fk]}</p>
                </div>
                {renderFeatureModelTable(fk)}
              </div>
            ))}

            {models.some((m) => m.tool_key === "photo") ? (
              <details className="rounded-xl border border-gray-800 bg-gray-900/30">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-300">
                  Advanced · Photo model definitions (provider / model)
                </summary>
                <div className="border-t border-gray-800 p-3">
                  <p className="mb-2 text-[11px] text-gray-500">
                    The provider model id behind each Nano tier. Extended models (Seedream, FLUX,
                    Imagen, Ideogram) resolve from code defaults unless overridden here.
                  </p>
                  {renderModelConfigTable(models.filter((m) => m.tool_key === "photo"))}
                </div>
              </details>
            ) : null}
          </section>

          {/* ---- Reels creation type (pipeline model roles) ---- */}
          {(["reels", "veo", "storyboard"] as const).some((t) =>
            models.some((m) => m.tool_key === t)
          ) ? (
            <section className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-white">Reels</h2>
                <p className="text-xs text-gray-500">
                  Video pipelines. Each feature is a fixed sequence of model roles (LLM, video, TTS,
                  Whisper) rather than an interchangeable catalog.
                </p>
              </div>
              {(["reels", "veo", "storyboard"] as const).map((toolKey) => {
                const rows = models.filter((m) => m.tool_key === toolKey);
                if (rows.length === 0) return null;
                return (
                  <div key={toolKey} className="space-y-2">
                    <h3 className="text-sm font-semibold text-violet-300">
                      {MODEL_CONFIG_GROUP[toolKey]?.feature ?? toolKey}
                    </h3>
                    {renderModelConfigTable(rows)}
                  </div>
                );
              })}
            </section>
          ) : null}

          {/* ---- Other model roles (render, legacy, anything ungrouped) ---- */}
          {models.some(
            (m) => !["reels", "veo", "storyboard", "photo"].includes(m.tool_key)
          ) ? (
            <section className="space-y-2">
              <h2 className="text-base font-semibold text-white">Other</h2>
              {renderModelConfigTable(
                models.filter(
                  (m) => !["reels", "veo", "storyboard", "photo"].includes(m.tool_key)
                )
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
