import Sidebar from "./dashboard/Sidebar";
import { CreditBalanceProvider } from "./credit-balance-context";
import { PricingProvider } from "./pricing-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CreditBalanceProvider>
      <PricingProvider>
        <div className="flex min-h-screen bg-gray-950 text-white">
          <Sidebar />
          <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-24 md:pb-0">
            {children}
          </main>
        </div>
      </PricingProvider>
    </CreditBalanceProvider>
  );
}
