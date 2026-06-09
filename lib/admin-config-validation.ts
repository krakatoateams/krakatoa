import type { CostUnit, PricingConfigPatch, PricingType } from "@/lib/pricing-configs-db";
import type { ModelConfigPatch } from "@/lib/model-configs-db";
import type { ToolConfigPatch } from "@/lib/tool-configs-db";

/**
 * Shared, pure validators for the Admin Config PATCH + reset endpoints
 * (Admin Phase 2.5). No I/O, no provider calls, no external model validation.
 *
 * Both the PATCH routes and the /reset routes run their patch through these so a
 * reset can never bypass validation. Hard errors reject the request (400);
 * `warnings` are advisory strings for the UI/logs only and never block a save.
 */

export type Validated<T> =
  | { ok: true; patch: T; warnings: string[] }
  | { ok: false; error: string };

const PRICING_TYPES: PricingType[] = ["fixed", "per_second", "per_image"];
const COST_UNITS: CostUnit[] = ["per_image", "per_second", "per_run", "per_1k_tokens"];
const CREDIT_AMOUNT_MAX = 100_000;
// Provider USD cost guard — generous upper bound; values are dollars per unit.
const PROVIDER_COST_USD_MAX = 1_000;
// Currency is locked to USD for Pricing Config v2.1 (provider prices are in USD).
const ALLOWED_CURRENCIES = new Set(["USD"]);

/** Providers we currently expect. Used for a WARNING only — never a hard reject. */
const KNOWN_PROVIDERS = new Set(["replicate", "rendi", "openai"]);

/** Defense-in-depth: reject anything that looks like a secret in parameters. */
export const SECRET_KEY_RE =
  /(secret|token|api[_-]?key|password|credential|authorization)/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function containsSecretKey(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some((k) => SECRET_KEY_RE.test(k));
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------
export function validatePricingPatch(
  body: Record<string, unknown>
): Validated<PricingConfigPatch> {
  const patch: PricingConfigPatch = {};
  const warnings: string[] = [];

  if (body.display_name !== undefined) {
    if (typeof body.display_name !== "string" || body.display_name.trim() === "") {
      return { ok: false, error: "display_name must be a non-empty string." };
    }
    patch.display_name = body.display_name.trim();
  }

  if (body.pricing_type !== undefined) {
    if (
      typeof body.pricing_type !== "string" ||
      !PRICING_TYPES.includes(body.pricing_type as PricingType)
    ) {
      return { ok: false, error: "pricing_type must be one of fixed, per_second, per_image." };
    }
    patch.pricing_type = body.pricing_type as PricingType;
  }

  if (body.credit_amount !== undefined) {
    if (
      typeof body.credit_amount !== "number" ||
      !Number.isInteger(body.credit_amount) ||
      body.credit_amount < 0 ||
      body.credit_amount > CREDIT_AMOUNT_MAX
    ) {
      return {
        ok: false,
        error: `credit_amount must be an integer between 0 and ${CREDIT_AMOUNT_MAX}.`,
      };
    }
    patch.credit_amount = body.credit_amount;
    if (body.credit_amount === 0) {
      const type = (patch.pricing_type ?? body.pricing_type) as PricingType | undefined;
      warnings.push(
        type === "per_second"
          ? "credit_amount is 0; video generations still floor to 1 credit."
          : "credit_amount is 0; this makes the generation free."
      );
    }
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return { ok: false, error: "enabled must be a boolean." };
    }
    patch.enabled = body.enabled;
  }

  if (body.metadata !== undefined) {
    if (!isPlainObject(body.metadata)) {
      return { ok: false, error: "metadata must be a JSON object." };
    }
    patch.metadata = body.metadata;
  }

  // ---- Pricing Config v2.1 fields ----
  if (body.provider_cost_usd !== undefined) {
    if (body.provider_cost_usd === null) {
      patch.provider_cost_usd = null;
    } else if (
      typeof body.provider_cost_usd !== "number" ||
      !Number.isFinite(body.provider_cost_usd) ||
      body.provider_cost_usd < 0 ||
      body.provider_cost_usd > PROVIDER_COST_USD_MAX
    ) {
      return {
        ok: false,
        error: `provider_cost_usd must be null or a number between 0 and ${PROVIDER_COST_USD_MAX}.`,
      };
    } else {
      patch.provider_cost_usd = body.provider_cost_usd;
      if (body.provider_cost_usd === 0) {
        warnings.push("provider_cost_usd is 0; this tier computes to 0 credits (free) on the v2 path.");
      }
    }
  }

  if (body.cost_unit !== undefined) {
    if (body.cost_unit === null) {
      patch.cost_unit = null;
    } else if (
      typeof body.cost_unit !== "string" ||
      !COST_UNITS.includes(body.cost_unit as CostUnit)
    ) {
      return {
        ok: false,
        error: "cost_unit must be null or one of per_image, per_second, per_run, per_1k_tokens.",
      };
    } else {
      patch.cost_unit = body.cost_unit as CostUnit;
    }
  }

  if (body.pricing_group !== undefined) {
    if (body.pricing_group === null) {
      patch.pricing_group = null;
    } else if (typeof body.pricing_group !== "string") {
      return { ok: false, error: "pricing_group must be null or a string." };
    } else {
      const trimmed = body.pricing_group.trim();
      patch.pricing_group = trimmed === "" ? null : trimmed;
    }
  }

  if (body.variant_key !== undefined) {
    if (body.variant_key === null) {
      patch.variant_key = null;
    } else if (typeof body.variant_key !== "string") {
      return { ok: false, error: "variant_key must be null or a string." };
    } else {
      const trimmed = body.variant_key.trim();
      patch.variant_key = trimmed === "" ? null : trimmed;
    }
  }

  if (body.currency !== undefined) {
    if (typeof body.currency !== "string" || !ALLOWED_CURRENCIES.has(body.currency.trim().toUpperCase())) {
      return { ok: false, error: "currency must be USD (only USD is supported in v2.1)." };
    }
    patch.currency = body.currency.trim().toUpperCase();
  }

  // Advisory: if provider_cost_usd is set, cost_unit should be present so the v2
  // path can engage. Never a hard reject (the resolver falls back to the built-in
  // v2 default for the key — never to a legacy/undercharging value).
  const resolvedCostUnit =
    patch.cost_unit !== undefined
      ? patch.cost_unit
      : typeof body.cost_unit === "string"
        ? (body.cost_unit as CostUnit)
        : undefined;
  if (
    patch.provider_cost_usd !== undefined &&
    patch.provider_cost_usd !== null &&
    !resolvedCostUnit
  ) {
    warnings.push("provider_cost_usd is set but cost_unit is empty; runtime will use the built-in v2 default for this key until cost_unit is set.");
  }

  return { ok: true, patch, warnings };
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
export function validateModelPatch(
  body: Record<string, unknown>
): Validated<ModelConfigPatch> {
  const patch: ModelConfigPatch = {};
  const warnings: string[] = [];

  if (body.provider !== undefined) {
    if (typeof body.provider !== "string" || body.provider.trim() === "") {
      return { ok: false, error: "provider must be a non-empty string." };
    }
    patch.provider = body.provider.trim();
    if (!KNOWN_PROVIDERS.has(patch.provider)) {
      warnings.push(
        `provider "${patch.provider}" is not a known provider (replicate, rendi, openai); double-check it.`
      );
    }
  }

  if (body.model !== undefined) {
    if (typeof body.model !== "string" || body.model.trim() === "") {
      return { ok: false, error: "model must be a non-empty string." };
    }
    // Keep the value as-is (no silent transform); surface shape issues as warnings.
    patch.model = body.model;
    if (/\s/.test(body.model)) {
      warnings.push("model contains whitespace; this may fail at generation time.");
    }
    const providerForShape = patch.provider ?? (typeof body.provider === "string" ? body.provider : undefined);
    if (providerForShape === "replicate" && !body.model.includes("/")) {
      warnings.push('model does not look like a Replicate id (expected "owner/name").');
    }
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return { ok: false, error: "enabled must be a boolean." };
    }
    patch.enabled = body.enabled;
  }

  if (body.is_default !== undefined) {
    if (typeof body.is_default !== "boolean") {
      return { ok: false, error: "is_default must be a boolean." };
    }
    patch.is_default = body.is_default;
  }

  if (body.parameters !== undefined) {
    if (!isPlainObject(body.parameters)) {
      return { ok: false, error: "parameters must be a JSON object." };
    }
    if (containsSecretKey(body.parameters)) {
      return { ok: false, error: "Secrets/API keys are not allowed in model parameters." };
    }
    patch.parameters = body.parameters;
  }

  if (body.metadata !== undefined) {
    if (!isPlainObject(body.metadata)) {
      return { ok: false, error: "metadata must be a JSON object." };
    }
    patch.metadata = body.metadata;
  }

  return { ok: true, patch, warnings };
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------
export function validateToolPatch(
  body: Record<string, unknown>
): Validated<ToolConfigPatch> {
  const patch: ToolConfigPatch = {};
  const warnings: string[] = [];

  if (body.display_name !== undefined) {
    if (typeof body.display_name !== "string" || body.display_name.trim() === "") {
      return { ok: false, error: "display_name must be a non-empty string." };
    }
    patch.display_name = body.display_name.trim();
  }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return { ok: false, error: "enabled must be a boolean." };
    }
    patch.enabled = body.enabled;
  }

  if (body.visible_in_sidebar !== undefined) {
    if (typeof body.visible_in_sidebar !== "boolean") {
      return { ok: false, error: "visible_in_sidebar must be a boolean." };
    }
    patch.visible_in_sidebar = body.visible_in_sidebar;
  }

  if (body.sort_order !== undefined) {
    if (
      typeof body.sort_order !== "number" ||
      !Number.isInteger(body.sort_order) ||
      body.sort_order < 0 ||
      body.sort_order > 100_000
    ) {
      return { ok: false, error: "sort_order must be an integer between 0 and 100000." };
    }
    patch.sort_order = body.sort_order;
  }

  if (body.metadata !== undefined) {
    if (!isPlainObject(body.metadata)) {
      return { ok: false, error: "metadata must be a JSON object." };
    }
    patch.metadata = body.metadata;
  }

  return { ok: true, patch, warnings };
}
