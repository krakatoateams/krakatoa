"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  User,
  Coins,
  Link2,
  SlidersHorizontal,
} from "lucide-react";
import AccountTab from "./AccountTab";
import CreditsTab from "./CreditsTab";
import ConnectionsTab from "./ConnectionsTab";
import BasicSettingsTab from "./BasicSettingsTab";
import PageContainer from "../PageContainer";
import PageHeader from "../PageHeader";

const TABS = [
  { id: "account", label: "Account", icon: User },
  { id: "credits", label: "Credits", icon: Coins },
  { id: "connections", label: "Connections", icon: Link2 },
  { id: "settings", label: "Basic Settings", icon: SlidersHorizontal },
] as const;

type TabId = (typeof TABS)[number]["id"];

const DEFAULT_TAB: TabId = "account";

function isTabId(value: string | null): value is TabId {
  return TABS.some((t) => t.id === value);
}

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab: TabId = isTabId(rawTab) ? rawTab : DEFAULT_TAB;

  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/dashboard/settings?${params.toString()}`, {
      scroll: false,
    });
  };

  return (
    <PageContainer>
      <PageHeader title="Profile Settings" />

      <div className="flex flex-col gap-8 md:flex-row">
        {/* Tab nav */}
        <nav className="md:w-52 md:shrink-0">
          <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = tab.id === activeTab;
              return (
                <li key={tab.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setTab(tab.id)}
                    className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-white/10 text-N900"
                        : "text-text-secondary hover:bg-white/10 hover:text-N900"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 ${
                        active ? "text-N900" : "text-text-disabled"
                      }`}
                    />
                    {tab.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Content panel */}
        <div className="min-w-0 flex-1">
          {activeTab === "account" && <AccountTab />}
          {activeTab === "credits" && <CreditsTab />}
          {activeTab === "connections" && <ConnectionsTab />}
          {activeTab === "settings" && <BasicSettingsTab />}
        </div>
      </div>
    </PageContainer>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <PageContainer>
          <div className="h-8 w-48 animate-pulse rounded bg-white/5" />
        </PageContainer>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
