"use client";

import { useSession } from "next-auth/react";
import { Video, Camera, Zap, CalendarClock } from "lucide-react";
import RecentCreations from "./RecentCreations";
import StatsRow from "./StatsRow";
import ToolCard from "./ToolCard";

const TOOLS = [
  {
    name: "Reels Creator",
    description: "Generate faceless video reels with AI narration and captions.",
    href: "/tools/video?type=reels-creator",
    icon: <Video className="h-5 w-5 text-indigo-400" />,
    accent: "bg-indigo-500/10",
  },
  {
    name: "Product Photo",
    description: "Transform product images into studio-quality shots with AI.",
    href: "/tools/photo",
    icon: <Camera className="h-5 w-5 text-purple-400" />,
    accent: "bg-purple-500/10",
  },
  {
    name: "Schedule",
    description: "Schedule and auto-publish videos to YouTube on autopilot.",
    href: "/tools/scheduler",
    icon: <CalendarClock className="h-5 w-5 text-emerald-400" />,
    accent: "bg-emerald-500/10",
  },
  {
    name: "IG Automation",
    description: "Auto-generate and post Instagram content on a schedule.",
    href: "/tools/ig",
    icon: <Zap className="h-5 w-5 text-amber-400" />,
    accent: "bg-amber-500/10",
    comingSoon: true,
  },
];

export default function DashboardPage() {
  const { data: session } = useSession();
  const firstName = session?.user?.name?.split(" ")[0] ?? "there";

  return (
    <div className="px-8 py-8">
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Welcome back, {firstName}</h1>
        <p className="mt-1 text-sm text-gray-500">
          Here&apos;s a snapshot of your scheduled content and the tools you can use.
        </p>
      </div>

      <RecentCreations />

      {/* Stats */}
      <section className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
          Scheduler activity
        </h2>
        <StatsRow />
      </section>

      {/* Tools */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
          Your tools
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {TOOLS.map((tool) => (
            <ToolCard key={tool.name} {...tool} />
          ))}
        </div>
      </section>
    </div>
  );
}
