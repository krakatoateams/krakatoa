"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { ResetPasswordModal } from "@/components/auth/ResetPasswordModal";
import { Button } from "@/components/ui/Button";
import { Video, Camera, CalendarClock, CalendarDays } from "lucide-react";
import DashboardHero from "./DashboardHero";
import RecentCreations from "./RecentCreations";
import TrendingTemplates from "./TrendingTemplates";
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
    icon: <Video className="h-5 w-5 text-gray-300" />,
    accent: "bg-white/10",
    thumbMediaType: "video" as const,
    thumbOutlined: true,
  },
  {
    name: "Photo",
    href: "/tools/photo-v2",
    icon: <Camera className="h-5 w-5 text-gray-300" />,
    accent: "bg-white/10",
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

// Auto-opens the sign-in modal when middleware bounced a logged-out visitor
// here from a protected route (?authRequired=1&next=...) — see
// kelolako-dashboard-nonlogin-plan and middleware.ts.
function AuthRequiredModalTrigger() {
  const searchParams = useSearchParams();
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();

  useEffect(() => {
    // Wait for status to actually resolve, and skip entirely if the visitor
    // is already signed in — e.g. hitting Back after a successful sign-in
    // lands back on this same ?authRequired=1 URL from browser history, and
    // shouldn't pop the modal again for someone who's already authenticated.
    if (status !== "unauthenticated") return;
    if (searchParams.get("authRequired") === "1") {
      openSignInModal(searchParams.get("next") ?? "/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return null;
}

export default function DashboardPage() {
  const { status, name } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const isAuthenticated = status === "authenticated";
  const firstName = name?.split(" ")[0];

  return (
    <PageContainer>
      <Suspense fallback={null}>
        <AuthRequiredModalTrigger />
      </Suspense>
      <ResetPasswordModal />

      <PageHeader
        title={isAuthenticated ? `Welcome back, ${firstName ?? "there"}` : "Welcome to Kelolako"}
        actions={
          !isAuthenticated && status !== "loading" ? (
            // Sidebar already has its own Sign in button on desktop (md+) —
            // this one exists only so mobile (where the Sidebar is hidden)
            // still has a way in.
            <Button
              variant="primary"
              size="md"
              className="md:hidden"
              onClick={() => openSignInModal()}
            >
              Sign in
            </Button>
          ) : undefined
        }
      />

      <DashboardHero />

      {/* Stats + recent creations need a real account — no point showing an
          all-zero/empty state to a logged-out visitor. */}
      {isAuthenticated && (
        <section className="mb-10">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
            Scheduler activity
          </h2>
          <StatsRow />
        </section>
      )}

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

      {isAuthenticated && <RecentCreations />}
    </PageContainer>
  );
}
