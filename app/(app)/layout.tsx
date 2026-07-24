import Sidebar from "./dashboard/Sidebar";
import { CreditBalanceProvider } from "./credit-balance-context";
import { PricingProvider } from "./pricing-context";
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
        <div className="flex min-h-screen bg-gray-950 text-white">
          <Sidebar initialToolVisibility={initialToolVisibility} />
          <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-24 md:pb-0">
            {children}
          </main>
        </div>
      </PricingProvider>
    </CreditBalanceProvider>
  );
}
