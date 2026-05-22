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
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}>
          {icon}
        </div>
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      </div>
      <p className="mt-4 text-3xl font-bold text-white">
        {loading ? <span className="inline-block h-8 w-12 animate-pulse rounded bg-gray-800" /> : value}
      </p>
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
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <StatsCard
        label="Scheduled Posts"
        value={counts.scheduled}
        icon={<CalendarClock className="h-4 w-4 text-blue-400" />}
        accent="bg-blue-500/10"
        loading={loading}
      />
      <StatsCard
        label="Published Posts"
        value={counts.published}
        icon={<CheckCircle2 className="h-4 w-4 text-green-400" />}
        accent="bg-green-500/10"
        loading={loading}
      />
      <StatsCard
        label="Failed Posts"
        value={counts.failed}
        icon={<AlertCircle className="h-4 w-4 text-red-400" />}
        accent="bg-red-500/10"
        loading={loading}
      />
    </div>
  );
}
