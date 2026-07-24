"use client";

import { useEffect, useState } from "react";
import { AdminOverviewSkeleton } from "./admin-ui";

type Summary = {
  jobs: {
    total: number;
    byStatus: Record<string, number>;
    byTool: Record<string, number>;
    capped: boolean;
  };
  credits: {
    totalBalance: number;
    lifetimeSpent: number;
    lifetimePurchased: number;
    walletsCapped: boolean;
  };
  ledger: {
    spendCount: number;
    spendAmount: number;
    refundCount: number;
    refundAmount: number;
    windowCapped: boolean;
  };
  recentFailedJobs: {
    id: string;
    tool: string;
    job_type: string;
    status: string;
    created_at: string;
    email: string | null;
  }[];
};

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-gray-500">{sub}</p> : null}
    </div>
  );
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/summary")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((d: Summary) => setData(d))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <AdminOverviewSkeleton />;
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">Jobs</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total Jobs" value={data.jobs.total} />
          <StatCard label="Succeeded" value={data.jobs.byStatus.succeeded ?? 0} />
          <StatCard label="Failed" value={data.jobs.byStatus.failed ?? 0} />
          <StatCard label="Running" value={data.jobs.byStatus.running ?? 0} />
        </div>
        {Object.keys(data.jobs.byTool).length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(data.jobs.byTool).map(([tool, count]) => (
              <span
                key={tool}
                className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300"
              >
                {tool}: {count}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">Credits</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total Balance" value={data.credits.totalBalance} sub="across all wallets" />
          <StatCard label="Lifetime Spent" value={data.credits.lifetimeSpent} />
          <StatCard label="Spend (ledger)" value={data.ledger.spendAmount} sub={`${data.ledger.spendCount} txns`} />
          <StatCard label="Refunds (ledger)" value={data.ledger.refundAmount} sub={`${data.ledger.refundCount} txns`} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
          Recent Failed Jobs
        </h2>
        {data.recentFailedJobs.length === 0 ? (
          <p className="text-sm text-gray-500">No failed jobs.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-900/60 text-[11px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Tool</th>
                  <th className="px-4 py-2 font-semibold">Job Type</th>
                  <th className="px-4 py-2 font-semibold">User</th>
                  <th className="px-4 py-2 font-semibold">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {data.recentFailedJobs.map((j) => (
                  <tr key={j.id} className="text-gray-300">
                    <td className="px-4 py-2">{j.tool}</td>
                    <td className="px-4 py-2">{j.job_type}</td>
                    <td className="px-4 py-2">{j.email ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-500">
                      {new Date(j.created_at).toLocaleString()}
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
