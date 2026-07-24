"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ExpirySettings = {
  regularCreditDays: number | null;
  purchaseBonusCreditDays: number | null;
  newUserBonusCreditDays: number | null;
  photoCreationDays: number | null;
  videoCreationDays: number | null;
};

type FieldKey = keyof ExpirySettings;

type FieldDef = {
  key: FieldKey;
  label: string;
  hint: string;
};

const CREDIT_FIELDS: FieldDef[] = [
  { key: "regularCreditDays", label: "Regular credits", hint: "Purchased base credits." },
  {
    key: "purchaseBonusCreditDays",
    label: "Purchase bonus credits",
    hint: "Promotional bonus bundled with a purchase.",
  },
  {
    key: "newUserBonusCreditDays",
    label: "New-user bonus credits",
    hint: "The initial sign-up bonus grant.",
  },
];

const CREATION_FIELDS: FieldDef[] = [
  { key: "photoCreationDays", label: "Photos", hint: "Generated product/character photos." },
  { key: "videoCreationDays", label: "Videos", hint: "Generated reels / videos." },
];

type FormState = Record<FieldKey, string>;

function toForm(settings: ExpirySettings): FormState {
  const one = (v: number | null) => (v === null ? "" : String(v));
  return {
    regularCreditDays: one(settings.regularCreditDays),
    purchaseBonusCreditDays: one(settings.purchaseBonusCreditDays),
    newUserBonusCreditDays: one(settings.newUserBonusCreditDays),
    photoCreationDays: one(settings.photoCreationDays),
    videoCreationDays: one(settings.videoCreationDays),
  };
}

export default function AdminExpiryPage() {
  const [form, setForm] = useState<FormState | null>(null);
  const [initial, setInitial] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningTarget, setRunningTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/expiry")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((d: { settings: ExpirySettings }) => {
        const f = toForm(d.settings);
        setForm(f);
        setInitial(f);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(
    () => !!form && !!initial && JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial]
  );

  const setField = (key: FieldKey, value: string) => {
    // Keep only non-negative integers (or empty = never).
    const cleaned = value.replace(/[^\d]/g, "");
    setForm((prev) => (prev ? { ...prev, [key]: cleaned } : prev));
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, number | null> = {};
      (Object.keys(form) as FieldKey[]).forEach((k) => {
        body[k] = form[k] === "" ? null : Number(form[k]);
      });
      const res = await fetch("/api/admin/expiry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      const f = toForm(data.settings as ExpirySettings);
      setForm(f);
      setInitial(f);
      setNotice("Expiry settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const runNow = async (target: "credits" | "photo" | "video", label: string) => {
    setRunningTarget(target);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/expiry/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      if (target === "credits") {
        const r = data.result as { lots_expired: number; credits_expired: number };
        setNotice(
          `Credit expiry ran: ${r.lots_expired} lot(s), ${r.credits_expired} credit(s) expired.`
        );
      } else {
        const r = data.result as { skipped: boolean; deletedRows: number; days: number | null };
        setNotice(
          r.skipped
            ? `${label}: no expiry configured — nothing deleted.`
            : `${label} expiry ran: ${r.deletedRows} deleted (older than ${r.days} days).`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run.");
    } finally {
      setRunningTarget(null);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!form) return <p className="text-sm text-red-400">{error ?? "Failed to load."}</p>;

  const renderRow = (field: FieldDef) => (
    <div
      key={field.key}
      className="flex items-center justify-between gap-4 border-b border-gray-800 py-3 last:border-b-0"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">{field.label}</p>
        <p className="text-xs text-gray-500">{field.hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          placeholder="Never"
          value={form[field.key]}
          onChange={(e) => setField(field.key, e.target.value)}
          className="w-28 rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-right text-sm text-white outline-none focus:border-violet-500"
        />
        <span className="w-10 text-xs text-gray-500">days</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 text-sm text-gray-400">
        Set how long each credit source and creation type lasts before it expires.
        Leave a field blank for <span className="text-gray-200">Never</span>. Credit
        durations apply to <span className="text-gray-200">new</span> grants (existing
        balances keep their current expiry); creation durations apply retroactively
        based on creation date. Expiry runs automatically each day, or trigger it now
        below.
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {/* Credits */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            Credit expiry
          </h2>
          <button
            type="button"
            disabled={runningTarget !== null}
            onClick={() => runNow("credits", "Credits")}
            className="rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-300 transition-colors hover:border-violet-500 hover:text-violet-300 disabled:opacity-50"
          >
            {runningTarget === "credits" ? "Running…" : "Run credit expiry now"}
          </button>
        </div>
        {CREDIT_FIELDS.map(renderRow)}
      </section>

      {/* Creations */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            Creation expiry
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={runningTarget !== null}
              onClick={() => runNow("photo", "Photos")}
              className="rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-300 transition-colors hover:border-violet-500 hover:text-violet-300 disabled:opacity-50"
            >
              {runningTarget === "photo" ? "Running…" : "Run photos"}
            </button>
            <button
              type="button"
              disabled={runningTarget !== null}
              onClick={() => runNow("video", "Videos")}
              className="rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-300 transition-colors hover:border-violet-500 hover:text-violet-300 disabled:opacity-50"
            >
              {runningTarget === "video" ? "Running…" : "Run videos"}
            </button>
          </div>
        </div>
        {CREATION_FIELDS.map(renderRow)}
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={save}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {dirty && !saving && (
          <button
            type="button"
            onClick={() => setForm(initial)}
            className="text-sm text-gray-400 transition-colors hover:text-white"
          >
            Discard
          </button>
        )}
      </div>

      <p className="text-xs text-gray-600">
        Deleting creations is permanent (storage objects + library rows). Credit
        expiry writes an &lsquo;expiry&rsquo; ledger entry per lot and reduces the
        wallet balance — the ledger remains the billing source of truth.
      </p>
    </div>
  );
}
