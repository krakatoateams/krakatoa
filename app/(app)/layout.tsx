import Sidebar from "./dashboard/Sidebar";
import { CreditBalanceProvider } from "./credit-balance-context";
import { PricingProvider } from "./pricing-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CreditBalanceProvider>
      <PricingProvider>
        <div className="flex min-h-screen bg-gray-950 text-white">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </PricingProvider>
    </CreditBalanceProvider>
  );
}
