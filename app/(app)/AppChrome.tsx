"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./dashboard/Sidebar";
import { ActiveGenerationBanner } from "@/components/ActiveGenerationBanner";
import type { ToolSidebarVisibility } from "@/lib/tool-configs-db";
import MobileAppHeader from "./MobileAppHeader";

function isCanvasPath(pathname: string | null): boolean {
  return pathname === "/tools/canvas" || !!pathname?.startsWith("/tools/canvas/");
}

function isEditorPath(pathname: string | null): boolean {
  return pathname === "/tools/editor" || !!pathname?.startsWith("/tools/editor/");
}

export default function AppChrome({
  children,
  initialToolVisibility = null,
}: {
  children: React.ReactNode;
  initialToolVisibility?: Record<string, ToolSidebarVisibility> | null;
}) {
  const pathname = usePathname();
  const canvas = isCanvasPath(pathname);
  const editor = isEditorPath(pathname);

  if (canvas || editor) {
    return (
      <div className="flex h-dvh overflow-hidden bg-N50 text-text-primary">
        <main className="h-full min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-N50 text-text-primary md:gap-2 md:p-2">
      <Sidebar initialToolVisibility={initialToolVisibility} />
      <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-24 md:h-[calc(100vh-1rem)] md:rounded-2xl md:pb-0">
        <MobileAppHeader />
        <ActiveGenerationBanner />
        {children}
      </main>
    </div>
  );
}
