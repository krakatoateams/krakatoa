"use client";

import { useCallback, useEffect, useState } from "react";

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

type Tab = "tools" | "pricing" | "models";

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

function isValidCreditAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount >= 0 && amount <= CREDIT_AMOUNT_MAX;
}

function pricingStatus(p: PricingConfig): { tone: BadgeTone; label: string } {
  if (!p.enabled) return { tone: "disabled", label: "Disabled — fallback/default used" };
  if (!isValidCreditAmount(p.credit_amount))
    return { tone: "invalid", label: "Invalid — fallback/default used" };
  return { tone: "active", label: "Runtime active" };
}

function pricingWarning(p: PricingConfig): string | null {
  if (p.credit_amount === 0) {
    return p.pricing_type === "per_second"
      ? "0 per second — video still floors to 1 credit."
      : "0 credits — this makes generation free.";
  }
  return null;
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [apiWarnings, setApiWarnings] = useState<string[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/config/tools").then((r) => r.json()),
      fetch("/api/admin/config/pricing").then((r) => r.json()),
      fetch("/api/admin/config/models").then((r) => r.json()),
    ])
      .then(([t, p, m]) => {
        setTools(t.tools ?? []);
        setPricing(p.pricing ?? []);
        setModels(m.models ?? []);
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
          <NoteBox>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>
                <span className="font-mono text-gray-300">per_second</span> means credits per second
                of video.
              </li>
              <li>Video always costs at least 1 credit, even at a 0 per-second rate.</li>
              <li>
                Setting a <span className="font-mono text-gray-300">fixed</span> /{" "}
                <span className="font-mono text-gray-300">per_image</span> amount to 0 makes that
                generation free.
              </li>
            </ul>
          </NoteBox>
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full">
              <thead className="bg-gray-900/60">
                <tr>
                  <th className={TH}>Pricing key</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>Credit amount</th>
                  <th className={TH}>Enabled</th>
                  <th className={TH}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {pricing.map((p) => {
                  const status = pricingStatus(p);
                  const warn = pricingWarning(p);
                  return (
                    <tr key={p.pricing_key} className="text-sm text-gray-300">
                      <td className="px-3 py-2">
                        <div className="font-medium text-white">{p.display_name}</div>
                        <div className="text-xs text-gray-500">{p.pricing_key}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="px-3 py-2 w-36">
                        <select
                          value={p.pricing_type}
                          onChange={(e) =>
                            setPricingField(p.pricing_key, "pricing_type", e.target.value)
                          }
                          className={INPUT}
                        >
                          <option value="fixed">fixed</option>
                          <option value="per_second">per_second</option>
                          <option value="per_image">per_image</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 w-32">
                        <input
                          type="number"
                          min={0}
                          max={CREDIT_AMOUNT_MAX}
                          value={p.credit_amount}
                          onChange={(e) =>
                            setPricingField(
                              p.pricing_key,
                              "credit_amount",
                              Number(e.target.value)
                            )
                          }
                          className={INPUT}
                        />
                        {warn ? (
                          <div className="mt-1 text-[11px] text-amber-300">⚠ {warn}</div>
                        ) : null}
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
                              pricing_type: p.pricing_type,
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!loading && tab === "models" ? (
        <div className="space-y-3">
          <NoteBox>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>Model IDs must be exact. No external validation is performed here.</li>
              <li>A typo is treated as intentional and can fail at generation time.</li>
              <li>
                The Whisper version pin lives in{" "}
                <span className="font-mono text-gray-300">parameters.version</span>.
              </li>
              <li>Secrets / API keys are never stored here — they stay in environment variables.</li>
            </ul>
          </NoteBox>
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full">
              <thead className="bg-gray-900/60">
                <tr>
                  <th className={TH}>Tool / key</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Provider</th>
                  <th className={TH}>Model</th>
                  <th className={TH}>Enabled</th>
                  <th className={TH}>Default</th>
                  <th className={TH}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {models.map((m) => {
                  const status = modelStatus(m);
                  const warn = modelWarning(m);
                  return (
                    <tr key={m.id} className="text-sm text-gray-300">
                      <td className="px-3 py-2">
                        <div className="font-medium text-white">{m.tool_key}</div>
                        <div className="text-xs text-gray-500">{m.config_key}</div>
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
                        {warn ? (
                          <div className="mt-1 text-[11px] text-amber-300">⚠ {warn}</div>
                        ) : null}
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
                            resetRow(
                              `/api/admin/config/models/${m.id}/reset`,
                              `${m.tool_key}/${m.config_key}`
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
    </div>
  );
}
