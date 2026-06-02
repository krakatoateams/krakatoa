"use client";

import { SessionProvider } from "next-auth/react";
import Sidebar from "./dashboard/Sidebar";
import { CreditBalanceProvider } from "./credit-balance-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <CreditBalanceProvider>
        <div className="flex min-h-screen bg-gray-950 text-white">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </CreditBalanceProvider>
    </SessionProvider>
  );
}
