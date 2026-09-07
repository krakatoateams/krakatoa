"use client";

import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, AlertCircle } from "lucide-react";

interface Post {
  id: string;
  status: "scheduled" | "published" | "failed" | "draft";
}

interface StatsCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: string;
  loading: boolean;
}

function StatsCard({ label, value, icon, accent, loading }: StatsCardProps) {
  return (
    <div className="rounded-xl bg-white/[0.04] p-3 md:p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg md:h-9 md:w-9 ${accent}`}>
          {icon}
        </div>
        <p className="text-[10px] font-medium uppercase leading-tight tracking-wider text-text-disabled md:text-xs">
          {label}
        </p>
        <p className="text-2xl font-bold leading-none text-N900 md:ml-auto md:text-3xl">
          {loading ? <span className="inline-block h-7 w-8 animate-pulse rounded bg-N900/10 md:h-8 md:w-12" /> : value}
        </p>
      </div>
    </div>
  );
}

export default function StatsRow() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/posts")
      .then((res) => (res.ok ? res.json() : { posts: [] }))
      .then((data) => setPosts(data.posts ?? []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

  const counts = {
    scheduled: posts.filter((p) => p.status === "scheduled").length,
    published: posts.filter((p) => p.status === "published").length,
    failed: posts.filter((p) => p.status === "failed").length,
  };

  return (
    <div className="grid grid-cols-3 gap-2 md:gap-4">
      <StatsCard
        label="Scheduled Posts"
        value={counts.scheduled}
        icon={<CalendarClock className="h-4 w-4 text-info" />}
        accent="bg-info/10"
        loading={loading}
      />
      <StatsCard
        label="Published Posts"
        value={counts.published}
        icon={<CheckCircle2 className="h-4 w-4 text-success" />}
        accent="bg-success/10"
        loading={loading}
      />
      <StatsCard
        label="Failed Posts"
        value={counts.failed}
        icon={<AlertCircle className="h-4 w-4 text-error" />}
        accent="bg-error/10"
        loading={loading}
      />
    </div>
  );
}
