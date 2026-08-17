import Sidebar from "./dashboard/Sidebar";
import { CreditBalanceProvider } from "./credit-balance-context";
import { PricingProvider } from "./pricing-context";
import { ActiveGenerationsProvider } from "./active-generations-context";
import { ActiveGenerationBanner } from "@/components/ActiveGenerationBanner";
import { getCurrentProfile } from "@/lib/profiles-db";
import {
  listToolConfigs,
  toToolSidebarVisibilityMap,
  type ToolSidebarVisibility,
} from "@/lib/tool-configs-db";

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
      <PricingProvider>
        <ActiveGenerationsProvider>
          <div className="flex min-h-screen bg-N50 text-text-primary md:gap-2 md:p-2">
            <Sidebar initialToolVisibility={initialToolVisibility} />
            <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-24 md:h-[calc(100vh-1rem)] md:rounded-2xl md:pb-0">
              <ActiveGenerationBanner />
              {children}
            </main>
          </div>
        </ActiveGenerationsProvider>
      </PricingProvider>
    </CreditBalanceProvider>
  );
}
