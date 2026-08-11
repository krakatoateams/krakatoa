"use client";

import { useEffect, useState } from "react";
import AdminAnalytics from "./AdminAnalytics";
import {
  AdminOverviewSkeleton,
  AdminTable,
  SectionHeading,
  StatCard,
} from "./admin-ui";

type FailedJob = {
  id: string;
  tool: string;
  job_type: string;
  status: string;
  created_at: string;
  email: string | null;
};

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
  recentFailedJobs: FailedJob[];
};

/** Operational snapshot: what the platform is doing right now. */
function SummaryStats({ data }: { data: Summary }) {
  return (
    <>
      <section>
        <SectionHeading>Jobs</SectionHeading>
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
        <SectionHeading>Credits</SectionHeading>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            label="Total Balance"
            value={data.credits.totalBalance}
            sub="across all wallets"
          />
          <StatCard label="Lifetime Spent" value={data.credits.lifetimeSpent} />
          <StatCard
            label="Spend (ledger)"
            value={data.ledger.spendAmount}
            sub={`${data.ledger.spendCount} txns`}
          />
          <StatCard
            label="Refunds (ledger)"
            value={data.ledger.refundAmount}
            sub={`${data.ledger.refundCount} txns`}
          />
        </div>
      </section>
    </>
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
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load.")
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    // Cards first (jobs, credits, then sales and users from AdminAnalytics),
    // then every breakdown table, with the failed-job tail last. AdminAnalytics
    // stays mounted while the summary loads so both requests run in parallel.
    <div className="space-y-8">
      {loading ? <AdminOverviewSkeleton /> : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {data ? <SummaryStats data={data} /> : null}

      <AdminAnalytics />

      {data ? (
        <section>
          <SectionHeading>Recent Failed Jobs</SectionHeading>
          <AdminTable<FailedJob>
            rows={data.recentFailedJobs}
            rowKey={(j) => j.id}
            empty="No failed jobs."
            columns={[
              { key: "tool", header: "Tool", render: (j) => j.tool },
              { key: "type", header: "Job Type", render: (j) => j.job_type },
              { key: "user", header: "User", render: (j) => j.email ?? "—" },
              {
                key: "when",
                header: "When",
                render: (j) => (
                  <span className="text-gray-500">
                    {new Date(j.created_at).toLocaleString()}
                  </span>
                ),
              },
            ]}
          />
        </section>
      ) : null}
    </div>
  );
}
