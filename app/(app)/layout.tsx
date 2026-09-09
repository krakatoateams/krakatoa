import AppChrome from "./AppChrome";
import { CreditBalanceProvider } from "./credit-balance-context";
import { PricingProvider } from "./pricing-context";
import { ActiveGenerationsProvider } from "./active-generations-context";
import { getCurrentProfile } from "@/lib/profiles-db";
import {
  listToolConfigs,
  toToolSidebarVisibilityMap,
  type ToolSidebarVisibility,
} from "@/lib/tool-configs-db";
import WelcomeVideoOfferModal from "@/components/WelcomeVideoOfferModal";
import { WelcomeVideoOfferProvider } from "@/lib/welcome-video-offer-context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let initialToolVisibility: Record<string, ToolSidebarVisibility> | null = null;
  try {
    const profile = await getCurrentProfile();
    if (profile) {
      initialToolVisibility = toToolSidebarVisibilityMap(await listToolConfigs());
    }
  } catch (e) {
    console.error("[app layout] tool config preload failed:", e);
  }

  return (
    <CreditBalanceProvider>
      {/* Wraps both {children} (the /dashboard fallback card lives inside
          it) and the modal below, under the SAME provider instance — so
          claiming in one surface hides both, not just the one clicked. */}
      <WelcomeVideoOfferProvider>
        <PricingProvider>
          <ActiveGenerationsProvider>
            <AppChrome initialToolVisibility={initialToolVisibility}>{children}</AppChrome>
            {/* Mounted at the app-shell level (not just /dashboard) so a new
                user lands on this "Claim" popup regardless of which tool
                they signed up from — e.g. Schedule, not just the dashboard. */}
            <WelcomeVideoOfferModal />
          </ActiveGenerationsProvider>
        </PricingProvider>
      </WelcomeVideoOfferProvider>
    </CreditBalanceProvider>
  );
}
