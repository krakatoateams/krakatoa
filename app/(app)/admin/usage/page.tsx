"use client";

import { useEffect, useState } from "react";

type UsageAggregate = {
  tool: string;
  provider: string | null;
  model: string | null;
  events: number;
  units: number;
  creditsCharged: number;
  estimatedCostUsd: number;
  estimatedCostIdr: number;
};

/** Format a USD money value. Tiny values keep up to 3 decimals so cents are visible. */
function fmtUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}

/** Format an IDR money value (no decimals; Indonesian thousands grouping). */
function fmtIdr(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return value.toLocaleString("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });
}

type RecentJob = {
  id: string;
  tool: string;
  job_type: string;
  status: string;
  cost_credits: number;
  created_at: string;
  email: string | null;
};

type LedgerEntry = {
  id: string;
  amount: number;
  direction: string;
  type: string;
  status: string;
  created_at: string;
  email: string | null;
};

type TopUser = {
  profile_id: string;
  email: string | null;
  display_name: string | null;
  balance: number;
  lifetime_spent: number;
};

const TH =
  "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500";

function StatusPill({ status }: { status: string }) {
  const color =
    status === "succeeded" || status === "active"
      ? "bg-emerald-500/15 text-emerald-300"
      : status === "failed"
        ? "bg-red-500/15 text-red-300"
        : "bg-gray-700 text-gray-300";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${color}`}>{status}</span>;
}

export default function AdminUsagePage() {
  const [usage, setUsage] = useState<UsageAggregate[]>([]);
  const [jobs, setJobs] = useState<RecentJob[]>([]);
  const [tx, setTx] = useState<LedgerEntry[]>([]);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/usage").then((r) => r.json()),
      fetch("/api/admin/jobs").then((r) => r.json()),
      fetch("/api/admin/credits").then((r) => r.json()),
    ])
      .then(([u, j, c]) => {
        setUsage(u.aggregates ?? []);
        setJobs(j.jobs ?? []);
        setTx(c.recentTransactions ?? []);
        setTopUsers(c.topUsers ?? []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-gray-500">Loading usage…</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
          Usage by provider / model
        </h2>
        {usage.length === 0 ? (
          <p className="text-sm text-gray-500">No usage events yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full">
              <thead className="bg-gray-900/60">
                <tr>
                  <th className={TH}>Tool</th>
                  <th className={TH}>Provider</th>
                  <th className={TH}>Model</th>
                  <th className={TH}>Events</th>
                  <th className={TH}>Units</th>
                  <th className={TH}>Credits</th>
                  <th className={TH}>Est. USD</th>
                  <th className={TH}>Est. Rupiah</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {usage.map((u, i) => (
                  <tr key={`${u.tool}-${u.model}-${i}`} className="text-sm text-gray-300">
                    <td className="px-3 py-2">{u.tool}</td>
                    <td className="px-3 py-2">{u.provider ?? "—"}</td>
                    <td className="px-3 py-2">{u.model ?? "—"}</td>
                    <td className="px-3 py-2">{u.events}</td>
                    <td className="px-3 py-2">{u.units}</td>
                    <td className="px-3 py-2">{u.creditsCharged}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtUsd(u.estimatedCostUsd)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtIdr(u.estimatedCostIdr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
          Top users by lifetime spend
        </h2>
        {topUsers.length === 0 ? (
          <p className="text-sm text-gray-500">No data.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full">
              <thead className="bg-gray-900/60">
                <tr>
                  <th className={TH}>User</th>
                  <th className={TH}>Balance</th>
                  <th className={TH}>Lifetime spent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {topUsers.map((u) => (
                  <tr key={u.profile_id} className="text-sm text-gray-300">
                    <td className="px-3 py-2">{u.email ?? u.display_name ?? u.profile_id}</td>
                    <td className="px-3 py-2">{u.balance}</td>
                    <td className="px-3 py-2">{u.lifetime_spent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
          Recent jobs
        </h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-gray-500">No jobs yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full">
              <thead className="bg-gray-900/60">
                <tr>
                  <th className={TH}>Tool</th>
                  <th className={TH}>Job type</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Credits</th>
                  <th className={TH}>User</th>
                  <th className={TH}>When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {jobs.map((j) => (
                  <tr key={j.id} className="text-sm text-gray-300">
                    <td className="px-3 py-2">{j.tool}</td>
                    <td className="px-3 py-2">{j.job_type}</td>
                    <td className="px-3 py-2">
                      <StatusPill status={j.status} />
                    </td>
                    <td className="px-3 py-2">{j.cost_credits}</td>
                    <td className="px-3 py-2">{j.email ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-500">
                      {new Date(j.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
          Recent credit transactions
        </h2>
        {tx.length === 0 ? (
          <p className="text-sm text-gray-500">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full">
              <thead className="bg-gray-900/60">
                <tr>
                  <th className={TH}>Type</th>
                  <th className={TH}>Direction</th>
                  <th className={TH}>Amount</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>User</th>
                  <th className={TH}>When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {tx.map((t) => (
                  <tr key={t.id} className="text-sm text-gray-300">
                    <td className="px-3 py-2">{t.type}</td>
                    <td className="px-3 py-2">{t.direction}</td>
                    <td className="px-3 py-2">{t.amount}</td>
                    <td className="px-3 py-2">
                      <StatusPill status={t.status} />
                    </td>
                    <td className="px-3 py-2">{t.email ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-500">
                      {new Date(t.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
