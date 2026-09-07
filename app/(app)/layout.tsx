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
          <AppChrome initialToolVisibility={initialToolVisibility}>{children}</AppChrome>
        </ActiveGenerationsProvider>
      </PricingProvider>
    </CreditBalanceProvider>
  );
}
