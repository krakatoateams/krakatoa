"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useCurrentUser } from "@/lib/auth-context";
import { Video, Camera, CalendarClock, CalendarDays } from "lucide-react";
import DashboardHero from "./DashboardHero";
import RecentCreations from "./RecentCreations";
import TrendingTemplates from "./TrendingTemplates";
import StatsRow from "./StatsRow";
import ToolCard from "./ToolCard";
import ToolCardThumbnail from "./ToolCardThumbnail";
import PageContainer from "./PageContainer";
import PageHeader from "./PageHeader";
import PromoOfferModal from "@/components/PromoOfferModal";
import { PROMO_DEADLINE, isPromoLive } from "@/lib/promo-offer";

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
    icon: <Video className="h-5 w-5 text-[#F26522]" />,
    accent: "bg-[#F26522]/10",
    thumbMediaType: "video" as const,
    thumbOutlined: true,
  },
  {
    name: "Photo",
    href: "/tools/photo-v2",
    icon: <Camera className="h-5 w-5 text-[#F26522]" />,
    accent: "bg-[#F26522]/10",
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
    name: "Calendar",
    href: "/tools/scheduler/calendar",
    icon: <CalendarDays className="h-5 w-5 text-sky-400" />,
    accent: "bg-sky-500/10",
  },
];

// Session-scoped so the promo shows once per browser session; the deadline is
// baked into the key so a new promo (new deadline) re-shows even if the last
// one was dismissed.
const PROMO_DISMISS_KEY = `promo:${PROMO_DEADLINE}`;

export default function DashboardPage() {
  const { name } = useCurrentUser();
  const firstName = name?.split(" ")[0] ?? "there";
  const [promoOpen, setPromoOpen] = useState(false);

  useEffect(() => {
    if (!isPromoLive()) return;
    if (sessionStorage.getItem(PROMO_DISMISS_KEY)) return;
    setPromoOpen(true);
  }, []);

  const closePromo = () => {
    sessionStorage.setItem(PROMO_DISMISS_KEY, "1");
    setPromoOpen(false);
  };

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

      <TrendingTemplates />

      <RecentCreations />

      <PromoOfferModal open={promoOpen} onClose={closePromo} />
    </PageContainer>
  );
}
