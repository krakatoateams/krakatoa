"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { ResetPasswordModal } from "@/components/auth/ResetPasswordModal";
import { Button } from "@/components/ui/Button";
import { Video, Camera, CalendarClock, CalendarDays } from "lucide-react";
import DashboardHero from "./DashboardHero";
import RecentCreations from "./RecentCreations";
import TrendingTemplates, { VideoTemplateCarousels } from "./TrendingTemplates";
import StatsRow from "./StatsRow";
import ToolCard from "./ToolCard";
import ToolCardThumbnail from "./ToolCardThumbnail";
import PageContainer from "./PageContainer";
import PageHeader from "./PageHeader";
import PromoOfferModal from "@/components/PromoOfferModal";
import { PROMO_DEADLINE, isPromoLive } from "@/lib/promo-offer";
import { useToolAvailabilityMap } from "@/lib/use-tool-availability";

type ToolDef = {
  name: string;
  href: string;
  icon: ReactNode;
  accent: string;
  // Maps to tool_configs.tool_key — resolves the live comingSoon flag from
  // /admin/config-v2 at render time (see TOOLS.map below). Not a static
  // per-tool default; every entry currently reads from the same DB source.
  toolKey: string;
  thumbMediaType?: "image" | "video";
  thumbOutlined?: boolean;
};

const TOOLS: ToolDef[] = [
  {
    name: "Video",
    href: "/tools/video?type=text2video",
    icon: <Video className="h-5 w-5 text-brand-primary" />,
    accent: "bg-brand-primary/10",
    toolKey: "reels",
    thumbMediaType: "video" as const,
    thumbOutlined: true,
  },
  {
    name: "Photo",
    href: "/tools/photo-v2",
    icon: <Camera className="h-5 w-5 text-brand-primary" />,
    accent: "bg-brand-primary/10",
    toolKey: "photo",
    thumbMediaType: "image" as const,
    thumbOutlined: true,
  },
  {
    name: "Schedule",
    href: "/tools/scheduler",
    icon: <CalendarClock className="h-5 w-5 text-icon-positive" />,
    accent: "bg-G500/10",
    toolKey: "schedule",
  },
  {
    name: "Calendar",
    href: "/tools/scheduler/calendar",
    icon: <CalendarDays className="h-5 w-5 text-info" />,
    accent: "bg-info/10",
    toolKey: "calendar",
  },
];

// Session-scoped so the promo shows once per browser session; the deadline is
// baked into the key so a new promo (new deadline) re-shows even if the last
// one was dismissed.
const PROMO_DISMISS_KEY = `promo:${PROMO_DEADLINE}`;

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
  const [promoOpen, setPromoOpen] = useState(false);
  const { map: toolAvailability } = useToolAvailabilityMap();
  // "Scheduler activity" (StatsRow: scheduled/published/failed post counts)
  // reads on both Schedule and Calendar being finished — showing live stats
  // for a feature area that's still being built reads as misleading, not
  // reassuring.
  const schedulerActivityReady =
    !toolAvailability.schedule?.comingSoon && !toolAvailability.calendar?.comingSoon;

  // Gate to signed-in users: the Claim CTA starts checkout, which requires
  // auth. The code-level deadline (isPromoLive) is a fast pre-check; the admin
  // master switch lives in the DB, so confirm with /api/promo-offer before
  // auto-opening. Re-evaluates once auth status resolves.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!isPromoLive()) return;
    if (sessionStorage.getItem(PROMO_DISMISS_KEY)) return;

    let cancelled = false;
    fetch("/api/promo-offer", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { live?: boolean } | null) => {
        if (cancelled || !d?.live) return;
        if (sessionStorage.getItem(PROMO_DISMISS_KEY)) return;
        setPromoOpen(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const closePromo = () => {
    sessionStorage.setItem(PROMO_DISMISS_KEY, "1");
    setPromoOpen(false);
  };

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
      {isAuthenticated && schedulerActivityReady && (
        <section className="mb-10">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-disabled">
            Scheduler activity
          </h2>
          <StatsRow />
        </section>
      )}

      {/* Tools */}
      <section className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-disabled">
          Your tools
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {TOOLS.map(({ thumbMediaType, thumbOutlined, toolKey, ...tool }) => (
            <ToolCard
              key={tool.name}
              {...tool}
              comingSoon={toolAvailability[toolKey]?.comingSoon ?? false}
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
      <VideoTemplateCarousels />

      {isAuthenticated && <RecentCreations />}

      <PromoOfferModal open={promoOpen} onClose={closePromo} />
    </PageContainer>
  );
}
