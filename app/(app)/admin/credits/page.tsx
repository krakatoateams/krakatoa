"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminTableSkeleton } from "../admin-ui";

type AdminWallet = {
  email: string;
  role: "owner" | "admin" | string;
  profile_id: string | null;
  balance: number;
  lifetime_spent: number;
};

const DEFAULT_TOPUP = 500;

export default function AdminCreditsPage() {
  const [wallets, setWallets] = useState<AdminWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [bonusBusyId, setBonusBusyId] = useState<string | null>(null);
  const [bonusAmounts, setBonusAmounts] = useState<Record<string, string>>({});
  const [bonusSource, setBonusSource] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/credits/wallets")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((d: { wallets: AdminWallet[] }) => setWallets(d.wallets))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load.")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setBalance = async (wallet: AdminWallet, targetBalance: number) => {
    if (!wallet.profile_id) return;
    if (!Number.isInteger(targetBalance) || targetBalance < 0) {
      setError("Enter a whole number of credits (0 or more).");
      return;
    }
    setBusyId(wallet.profile_id);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/credits/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: wallet.profile_id, targetBalance }),
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(body.error ?? `Request failed (${res.status})`);
      setNotice(
        body.applied
          ? `${wallet.email} balance set to ${body.balance} (was ${body.previousBalance}).`
          : `${wallet.email} is already at ${body.balance}.`
      );
      setAmounts((prev) => ({ ...prev, [wallet.profile_id as string]: "" }));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set balance.");
    } finally {
      setBusyId(null);
    }
  };

  const grantBonus = async (
    wallet: AdminWallet,
    amount: number,
    source: string
  ) => {
    if (!wallet.profile_id) return;
    if (!Number.isInteger(amount) || amount <= 0) {
      setError("Enter a whole number of bonus credits (1 or more).");
      return;
    }
    setBonusBusyId(wallet.profile_id);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/credits/grant-bonus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: wallet.profile_id, amount, source }),
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(body.error ?? `Request failed (${res.status})`);
      const expiry = body.expiresAt
        ? `expires ${new Date(body.expiresAt).toLocaleDateString()}`
        : "no expiry";
      setNotice(
        `Granted ${amount} bonus credits to ${wallet.email} — new balance ${body.balance} (${expiry}).`
      );
      setBonusAmounts((prev) => ({ ...prev, [wallet.profile_id as string]: "" }));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to grant bonus.");
    } finally {
      setBonusBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <h2 className="text-sm font-semibold text-white">Dummy credits</h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">
          Only admins / owners are auto-granted the initial 500 dummy credits on
          sign-up — regular users start at a 0 balance. Use the controls below to
          reset or top-up an admin&apos;s dummy balance (e.g. when testing has
          drained it). Each change is recorded as an{" "}
          <span className="text-gray-300">adjustment</span> in the credit ledger.
        </p>
      </div>

      {notice ? <p className="text-sm text-emerald-400">{notice}</p> : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {loading ? (
        <AdminTableSkeleton rows={6} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-900/60 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Admin</th>
                <th className="px-4 py-2 font-semibold">Role</th>
                <th className="px-4 py-2 font-semibold text-right">Balance</th>
                <th className="px-4 py-2 font-semibold text-right">
                  Lifetime spent
                </th>
                <th className="px-4 py-2 font-semibold text-right">
                  Set balance
                </th>
                <th className="px-4 py-2 font-semibold text-right">
                  Grant bonus
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {wallets.map((w) => {
                const key = w.profile_id ?? w.email;
                const busy = busyId === w.profile_id;
                const linked = Boolean(w.profile_id);
                return (
                  <tr key={key} className="text-gray-300">
                    <td className="px-4 py-2">{w.email}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          w.role === "owner"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-violet-500/15 text-violet-300"
                        }`}
                      >
                        {w.role}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-white">
                      {linked ? w.balance.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">
                      {linked ? w.lifetime_spent.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {linked ? (
                        <div className="flex items-center justify-end gap-2">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            placeholder={String(DEFAULT_TOPUP)}
                            value={amounts[w.profile_id as string] ?? ""}
                            onChange={(e) =>
                              setAmounts((prev) => ({
                                ...prev,
                                [w.profile_id as string]: e.target.value,
                              }))
                            }
                            className="w-24 rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-right text-sm text-white outline-none focus:border-violet-500"
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const raw = amounts[w.profile_id as string];
                              const value = raw === "" || raw == null ? NaN : Number(raw);
                              if (!Number.isFinite(value)) {
                                setError("Enter a whole number of credits.");
                                return;
                              }
                              setBalance(w, Math.trunc(value));
                            }}
                            className="rounded-md bg-violet-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
                          >
                            {busy ? "Saving…" : "Set"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setBalance(w, DEFAULT_TOPUP)}
                            className="rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-300 transition-colors hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-50"
                          >
                            Reset to {DEFAULT_TOPUP}
                          </button>
                        </div>
                      ) : (
                        <p className="text-right text-xs text-gray-600">
                          Sign-in required
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {linked ? (
                        <div className="flex items-center justify-end gap-2">
                          <input
                            type="number"
                            min={1}
                            step={1}
                            inputMode="numeric"
                            placeholder="e.g. 100"
                            value={bonusAmounts[w.profile_id as string] ?? ""}
                            onChange={(e) =>
                              setBonusAmounts((prev) => ({
                                ...prev,
                                [w.profile_id as string]: e.target.value,
                              }))
                            }
                            className="w-20 rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-right text-sm text-white outline-none focus:border-violet-500"
                          />
                          <select
                            value={
                              bonusSource[w.profile_id as string] ?? "new_user_bonus"
                            }
                            onChange={(e) =>
                              setBonusSource((prev) => ({
                                ...prev,
                                [w.profile_id as string]: e.target.value,
                              }))
                            }
                            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-white outline-none focus:border-violet-500"
                          >
                            <option value="new_user_bonus">New-user</option>
                            <option value="purchase_bonus">Purchase</option>
                          </select>
                          <button
                            type="button"
                            disabled={bonusBusyId === w.profile_id}
                            onClick={() => {
                              const raw = bonusAmounts[w.profile_id as string];
                              const value =
                                raw === "" || raw == null ? NaN : Number(raw);
                              if (!Number.isFinite(value)) {
                                setError("Enter a whole number of bonus credits.");
                                return;
                              }
                              grantBonus(
                                w,
                                Math.trunc(value),
                                bonusSource[w.profile_id as string] ?? "new_user_bonus"
                              );
                            }}
                            className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                          >
                            {bonusBusyId === w.profile_id ? "Granting…" : "Grant"}
                          </button>
                        </div>
                      ) : (
                        <p className="text-right text-xs text-gray-600">
                          Sign-in required
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-600">
        Setting a balance writes a single ledger adjustment to reach the exact
        target. Granting bonus credits adds a new bonus lot on top of the current
        balance, tagged with the selected bonus type so it inherits that type&apos;s
        configured expiry (see the Expiry tab). Admins who have never signed in
        have no wallet yet and cannot be topped up until their first sign-in.
      </p>
    </div>
  );
}
