"use client";

import type { ReactNode } from "react";
import { useCurrentUser } from "@/lib/auth-context";
import { Video, Camera, Zap, CalendarClock } from "lucide-react";
import DashboardHero from "./DashboardHero";
import RecentCreations from "./RecentCreations";
import StatsRow from "./StatsRow";
import ToolCard from "./ToolCard";
import ToolCardThumbnail from "./ToolCardThumbnail";
import PageContainer from "./PageContainer";
import PageHeader from "./PageHeader";

type ToolDef = {
  name: string;
  href: string;
  icon: ReactNode;
  accent: string;
  comingSoon?: boolean;
  thumbMediaType?: "image" | "video";
  thumbOutlined?: boolean;
};

const TOOLS: ToolDef[] = [
  {
    name: "Video",
    href: "/tools/video?type=reels-creator",
    icon: <Video className="h-5 w-5 text-indigo-400" />,
    accent: "bg-indigo-500/10",
    thumbMediaType: "video" as const,
    thumbOutlined: true,
  },
  {
    name: "Photo",
    href: "/tools/photo-v2",
    icon: <Camera className="h-5 w-5 text-purple-400" />,
    accent: "bg-purple-500/10",
    thumbMediaType: "image" as const,
    thumbOutlined: true,
  },
  {
    name: "Schedule",
    href: "/tools/scheduler",
    icon: <CalendarClock className="h-5 w-5 text-emerald-400" />,
    accent: "bg-emerald-500/10",
  },
  {
    name: "Instagram",
    href: "/tools/ig",
    icon: <Zap className="h-5 w-5 text-amber-400" />,
    accent: "bg-amber-500/10",
    comingSoon: true,
  },
];

export default function DashboardPage() {
  const { name } = useCurrentUser();
  const firstName = name?.split(" ")[0] ?? "there";

  return (
    <PageContainer>
      <PageHeader title={`Welcome back, ${firstName}`} />

      <DashboardHero />

      {/* Stats */}
      <section className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
          Scheduler activity
        </h2>
        <StatsRow />
      </section>

      {/* Tools */}
      <section className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
          Your tools
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {TOOLS.map(({ thumbMediaType, thumbOutlined, ...tool }) => (
            <ToolCard
              key={tool.name}
              {...tool}
              thumbnail={
                thumbMediaType ? (
                  <ToolCardThumbnail
                    mediaType={thumbMediaType}
                    outlined={thumbOutlined}
                  />
                ) : undefined
              }
            />
          ))}
        </div>
      </section>

      <RecentCreations />
    </PageContainer>
  );
}
