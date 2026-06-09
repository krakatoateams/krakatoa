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

const TH =
  "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500";
const INPUT =
  "w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-white outline-none focus:border-violet-500";

function SaveButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-md bg-violet-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
    >
      Save
    </button>
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
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setNotice("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
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
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
        Phase Admin 1: pricing and model edits are saved to the database for
        configuration only. Generation routes still use the code constants/model
        IDs and will not read these values until Phase Admin 2 wires resolvers
        (with fallback).
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
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {loading ? <p className="text-sm text-gray-500">Loading config…</p> : null}

      {!loading && tab === "tools" ? (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full">
            <thead className="bg-gray-900/60">
              <tr>
                <th className={TH}>Tool</th>
                <th className={TH}>Enabled</th>
                <th className={TH}>Visible in sidebar</th>
                <th className={TH}>Sort</th>
                <th className={TH}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {tools.map((t) => (
                <tr key={t.tool_key} className="text-sm text-gray-300">
                  <td className="px-3 py-2">
                    <div className="font-medium text-white">{t.display_name}</div>
                    <div className="text-xs text-gray-500">{t.tool_key}</div>
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
                    <SaveButton
                      busy={busy}
                      onClick={() =>
                        patch(`/api/admin/config/tools/${t.tool_key}`, {
                          enabled: t.enabled,
                          visible_in_sidebar: t.visible_in_sidebar,
                          sort_order: t.sort_order,
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && tab === "pricing" ? (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full">
            <thead className="bg-gray-900/60">
              <tr>
                <th className={TH}>Pricing key</th>
                <th className={TH}>Type</th>
                <th className={TH}>Credit amount</th>
                <th className={TH}>Enabled</th>
                <th className={TH}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {pricing.map((p) => (
                <tr key={p.pricing_key} className="text-sm text-gray-300">
                  <td className="px-3 py-2">
                    <div className="font-medium text-white">{p.display_name}</div>
                    <div className="text-xs text-gray-500">{p.pricing_key}</div>
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
                  <td className="px-3 py-2 w-28">
                    <input
                      type="number"
                      min={0}
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
                    <SaveButton
                      busy={busy}
                      onClick={() =>
                        patch(`/api/admin/config/pricing/${p.pricing_key}`, {
                          pricing_type: p.pricing_type,
                          credit_amount: p.credit_amount,
                          enabled: p.enabled,
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && tab === "models" ? (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full">
            <thead className="bg-gray-900/60">
              <tr>
                <th className={TH}>Tool / key</th>
                <th className={TH}>Provider</th>
                <th className={TH}>Model</th>
                <th className={TH}>Enabled</th>
                <th className={TH}>Default</th>
                <th className={TH}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {models.map((m) => (
                <tr key={m.id} className="text-sm text-gray-300">
                  <td className="px-3 py-2">
                    <div className="font-medium text-white">{m.tool_key}</div>
                    <div className="text-xs text-gray-500">{m.config_key}</div>
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
                    <SaveButton
                      busy={busy}
                      onClick={() =>
                        patch(`/api/admin/config/models/${m.id}`, {
                          provider: m.provider,
                          model: m.model,
                          enabled: m.enabled,
                          is_default: m.is_default,
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
