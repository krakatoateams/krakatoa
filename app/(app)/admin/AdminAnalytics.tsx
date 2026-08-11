"use client";

import { useEffect, useState } from "react";
import { formatIdr } from "@/lib/credit-packs";
import {
  AdminPagination,
  AdminTable,
  AdminTableSkeleton,
  SectionHeading,
  StatCard,
  type AdminColumn,
} from "./admin-ui";

/**
 * Business analytics block on the admin Overview: sales, users, and the seven
 * paginated breakdowns. Loads and fails independently of the operational
 * summary above it, so a missing migration or a slow aggregate never blanks the
 * whole page.
 */

const PAGE_SIZE = 10;

type DailyMetric = {
  day: string;
  activeUsers: number;
  jobs: number;
  creditsSpent: number;
  paidOrders: number;
  revenueIdr: number;
  consumptionIdr: number;
  netIdr: number;
};

type NewUser = {
  id: string;
  email: string | null;
  country: string | null;
  createdAt: string;
  creditsUsed: number;
  balance: number;
};

type Analytics = {
  headline: {
    revenueIdr: number;
    paidOrders: number;
    creditsSpent: number;
    consumptionIdr: number;
    netIdr: number;
    totalUsers: number;
    spendingUsers: number;
    avgCreditsPerSpendingUser: number;
    newUsersLast30Days: number;
    dauToday: number;
    creditValueIdr: number;
  };
  features: {
    jobType: string;
    tool: string | null;
    runs: number;
    succeeded: number;
    failed: number;
    credits: number;
  }[];
  models: {
    provider: string;
    model: string;
    tool: string | null;
    runs: number;
    credits: number;
  }[];
  packs: {
    packId: string;
    label: string;
    orders: number;
    creditsSold: number;
    revenueIdr: number;
  }[];
  countries: { country: string; users: number }[];
};

type Paged<T> = { rows: T[]; total: number };

const num = (n: number) => n.toLocaleString();

function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        timeZone: "UTC",
      });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function share(value: number, total: number): string {
  if (total <= 0) return "—";
  return `${((value / total) * 100).toFixed(1)}%`;
}

/** Signed IDR, coloured so a giveaway month reads as negative at a glance. */
function NetIdr({ value }: { value: number }) {
  const tone = value < 0 ? "text-amber-300" : "text-emerald-300";
  return (
    <span className={tone}>
      {value < 0 ? "-" : ""}
      {formatIdr(Math.abs(value))}
    </span>
  );
}

/** Server-paginated endpoint. Keeps the previous page visible while refetching. */
function usePagedEndpoint<T>(path: string) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<T>>({ rows: [], total: 0 });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    const offset = (page - 1) * PAGE_SIZE;
    fetch(`${path}?limit=${PAGE_SIZE}&offset=${offset}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((d: Paged<T>) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, page]);

  return { page, setPage, data, busy, error };
}

/** Client-side paging for the small aggregates, which arrive whole. */
function useLocalPage<T>(rows: T[]) {
  const [page, setPage] = useState(1);
  const start = (page - 1) * PAGE_SIZE;
  return {
    page,
    setPage,
    slice: rows.slice(start, start + PAGE_SIZE),
    total: rows.length,
  };
}

function PagedSection<T>({
  title,
  note,
  columns,
  rows,
  rowKey,
  empty,
}: {
  title: string;
  note?: string;
  columns: AdminColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  empty?: string;
}) {
  const { page, setPage, slice, total } = useLocalPage(rows);
  return (
    <section>
      <SectionHeading>{title}</SectionHeading>
      {note ? <p className="mb-3 -mt-1 text-xs text-gray-500">{note}</p> : null}
      <AdminTable columns={columns} rows={slice} rowKey={rowKey} empty={empty} />
      <AdminPagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
      />
    </section>
  );
}

export default function AdminAnalytics() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const daily = usePagedEndpoint<DailyMetric>("/api/admin/analytics/daily");
  const dau = usePagedEndpoint<DailyMetric>("/api/admin/analytics/daily");
  const users = usePagedEndpoint<NewUser>("/api/admin/analytics/users");

  useEffect(() => {
    fetch("/api/admin/analytics")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `Request failed (${res.status})`);
        }
        return res.json();
      })
      .then((d: Analytics) => setData(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Denominators for the per-table "share" columns.
  const totalRuns = (data?.features ?? []).reduce((s, f) => s + f.runs, 0);
  const totalModelRuns = (data?.models ?? []).reduce((s, m) => s + m.runs, 0);
  const totalPackRevenue = (data?.packs ?? []).reduce(
    (s, p) => s + p.revenueIdr,
    0
  );
  const totalCountryUsers = (data?.countries ?? []).reduce(
    (s, c) => s + c.users,
    0
  );

  if (loading) {
    return (
      <section>
        <SectionHeading>Sales</SectionHeading>
        <AdminTableSkeleton rows={4} />
      </section>
    );
  }

  if (error) {
    return (
      <section>
        <SectionHeading>Sales</SectionHeading>
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
          {error}
        </div>
      </section>
    );
  }

  if (!data) return null;

  const h = data.headline;

  return (
    <>
      <section>
        <SectionHeading>Sales</SectionHeading>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            label="Revenue"
            value={formatIdr(h.revenueIdr)}
            sub={`${num(h.paidOrders)} paid orders`}
          />
          <StatCard
            label="Credits consumed"
            value={formatIdr(h.consumptionIdr)}
            sub={`${num(h.creditsSpent)} credits @ ${formatIdr(h.creditValueIdr)}`}
          />
          <StatCard
            label="Net"
            value={`${h.netIdr < 0 ? "-" : ""}${formatIdr(Math.abs(h.netIdr))}`}
            sub={
              h.netIdr < 0 ? "consumption over revenue" : "revenue over consumption"
            }
          />
          <StatCard
            label="Avg credits / user"
            value={num(h.avgCreditsPerSpendingUser)}
            sub={`${num(h.spendingUsers)} of ${num(h.totalUsers)} users have spent`}
          />
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Consumption is credits spent valued at the current credit rate, not
          provider cost — the platform does not record provider spend per
          generation. Welcome and bonus credits are free, so consumption
          exceeding revenue is giveaway burn rather than a loss.
        </p>
      </section>

      <section>
        <SectionHeading>Users</SectionHeading>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatCard label="Total users" value={num(h.totalUsers)} />
          <StatCard label="New (30 days)" value={num(h.newUsersLast30Days)} />
          <StatCard
            label="Active today"
            value={num(h.dauToday)}
            sub="ran at least one job"
          />
        </div>
      </section>

      <section>
        <SectionHeading>Sales by day</SectionHeading>
        {daily.error ? (
          <p className="text-sm text-red-300">{daily.error}</p>
        ) : (
          <>
            <AdminTable<DailyMetric>
              rows={daily.data.rows}
              rowKey={(r) => r.day}
              empty="No activity yet."
              columns={[
                { key: "day", header: "Date", render: (r) => formatDay(r.day) },
                {
                  key: "orders",
                  header: "Orders",
                  align: "right",
                  render: (r) => num(r.paidOrders),
                },
                {
                  key: "revenue",
                  header: "Revenue",
                  align: "right",
                  render: (r) => formatIdr(r.revenueIdr),
                },
                {
                  key: "credits",
                  header: "Credits used",
                  align: "right",
                  render: (r) => num(r.creditsSpent),
                },
                {
                  key: "consumption",
                  header: "Consumption",
                  align: "right",
                  render: (r) => formatIdr(r.consumptionIdr),
                },
                {
                  key: "net",
                  header: "Net",
                  align: "right",
                  render: (r) => <NetIdr value={r.netIdr} />,
                },
              ]}
            />
            <AdminPagination
              page={daily.page}
              pageSize={PAGE_SIZE}
              total={daily.data.total}
              onPageChange={daily.setPage}
              busy={daily.busy}
            />
          </>
        )}
      </section>

      <section>
        <SectionHeading>New users registered</SectionHeading>
        <p className="mb-3 -mt-1 text-xs text-gray-500">
          Country is captured from the edge geo header on sign-in. Users who
          registered before this shipped show Unknown until they next visit.
        </p>
        {users.error ? (
          <p className="text-sm text-red-300">{users.error}</p>
        ) : (
          <>
            <AdminTable<NewUser>
              rows={users.data.rows}
              rowKey={(r) => r.id}
              empty="No users yet."
              columns={[
                {
                  key: "email",
                  header: "Email",
                  render: (r) => r.email ?? "—",
                },
                {
                  key: "country",
                  header: "Country",
                  render: (r) =>
                    r.country ?? <span className="text-gray-600">Unknown</span>,
                },
                {
                  key: "created",
                  header: "Registered",
                  render: (r) => formatDateTime(r.createdAt),
                },
                {
                  key: "used",
                  header: "Credits used",
                  align: "right",
                  render: (r) => num(r.creditsUsed),
                },
                {
                  key: "balance",
                  header: "Balance",
                  align: "right",
                  render: (r) => num(r.balance),
                },
              ]}
            />
            <AdminPagination
              page={users.page}
              pageSize={PAGE_SIZE}
              total={users.data.total}
              onPageChange={users.setPage}
              busy={users.busy}
            />
          </>
        )}
      </section>

      <section>
        <SectionHeading>Daily active users</SectionHeading>
        <p className="mb-3 -mt-1 text-xs text-gray-500">
          Active means the user started at least one job that day. There is no
          session tracking, so browsing without generating does not count.
        </p>
        {dau.error ? (
          <p className="text-sm text-red-300">{dau.error}</p>
        ) : (
          <>
            <AdminTable<DailyMetric>
              rows={dau.data.rows}
              rowKey={(r) => r.day}
              empty="No activity yet."
              columns={[
                { key: "day", header: "Date", render: (r) => formatDay(r.day) },
                {
                  key: "dau",
                  header: "Active users",
                  align: "right",
                  render: (r) => num(r.activeUsers),
                },
                {
                  key: "jobs",
                  header: "Jobs",
                  align: "right",
                  render: (r) => num(r.jobs),
                },
                {
                  key: "credits",
                  header: "Credits spent",
                  align: "right",
                  render: (r) => num(r.creditsSpent),
                },
                {
                  key: "perUser",
                  header: "Jobs / user",
                  align: "right",
                  render: (r) =>
                    r.activeUsers > 0 ? (r.jobs / r.activeUsers).toFixed(1) : "—",
                },
              ]}
            />
            <AdminPagination
              page={dau.page}
              pageSize={PAGE_SIZE}
              total={dau.data.total}
              onPageChange={dau.setPage}
              busy={dau.busy}
            />
          </>
        )}
      </section>

      <PagedSection
        title="Country"
        columns={[
          { key: "country", header: "Country", render: (r) => r.country },
          {
            key: "users",
            header: "Users",
            align: "right",
            render: (r) => num(r.users),
          },
          {
            key: "share",
            header: "Share",
            align: "right",
            render: (r) => share(r.users, totalCountryUsers),
          },
        ]}
        rows={data.countries}
        rowKey={(r) => r.country}
        empty="No users yet."
      />

      <PagedSection
        title="Most used feature"
        columns={[
          { key: "feature", header: "Feature", render: (r) => r.jobType },
          { key: "tool", header: "Tool", render: (r) => r.tool ?? "—" },
          {
            key: "runs",
            header: "Runs",
            align: "right",
            render: (r) => num(r.runs),
          },
          {
            key: "ok",
            header: "Succeeded",
            align: "right",
            render: (r) => num(r.succeeded),
          },
          {
            key: "failed",
            header: "Failed",
            align: "right",
            render: (r) => num(r.failed),
          },
          {
            key: "credits",
            header: "Credits",
            align: "right",
            render: (r) => num(r.credits),
          },
          {
            key: "share",
            header: "Share",
            align: "right",
            render: (r) => share(r.runs, totalRuns),
          },
        ]}
        rows={data.features}
        rowKey={(r) => r.jobType}
        empty="No jobs yet."
      />

      <PagedSection
        title="Most used AI model"
        note="Counted from usage events, which are only written on success — so these run counts sit below the job counts above."
        columns={[
          { key: "model", header: "Model", render: (r) => r.model },
          { key: "provider", header: "Provider", render: (r) => r.provider },
          { key: "tool", header: "Tool", render: (r) => r.tool ?? "—" },
          {
            key: "runs",
            header: "Runs",
            align: "right",
            render: (r) => num(r.runs),
          },
          {
            key: "credits",
            header: "Credits",
            align: "right",
            render: (r) => num(r.credits),
          },
          {
            key: "share",
            header: "Share",
            align: "right",
            render: (r) => share(r.runs, totalModelRuns),
          },
        ]}
        rows={data.models}
        rowKey={(r) => `${r.provider}::${r.model}`}
        empty="No usage events yet."
      />

      <PagedSection
        title="Most paid package"
        columns={[
          { key: "label", header: "Package", render: (r) => r.label },
          {
            key: "orders",
            header: "Orders",
            align: "right",
            render: (r) => num(r.orders),
          },
          {
            key: "credits",
            header: "Credits sold",
            align: "right",
            render: (r) => num(r.creditsSold),
          },
          {
            key: "revenue",
            header: "Revenue",
            align: "right",
            render: (r) => formatIdr(r.revenueIdr),
          },
          {
            key: "share",
            header: "Share",
            align: "right",
            render: (r) => share(r.revenueIdr, totalPackRevenue),
          },
        ]}
        rows={data.packs}
        rowKey={(r) => r.packId}
        empty="No paid orders yet."
      />
    </>
  );
}
