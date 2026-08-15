"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useActiveGenerations } from "@/app/(app)/active-generations-context";
import { isCurrentTool, isLiveStatus } from "@/lib/active-generations-pure";

/** Follows the user across tools so an in-flight generation isn't a blank page.
 *  Hidden on the tool that already shows the composer spinner + history tiles. */
export function ActiveGenerationBanner() {
  const pathname = usePathname();
  const { items } = useActiveGenerations();
  const relevant = items.filter(
    (i) =>
      (isLiveStatus(i.status) || i.status === "recoverable") &&
      !isCurrentTool(pathname, i.navHref),
  );
  const live = relevant.filter((i) => isLiveStatus(i.status));
  const recoverable = relevant.filter((i) => i.status === "recoverable");
  if (live.length === 0 && recoverable.length === 0) return null;

  const lead = live[0] ?? recoverable[0];
  const extraLive = live.length - (live.length > 0 ? 1 : 0);
  const copy =
    live.length === 0
      ? `${lead.label} paused — try again`
      : extraLive > 0
        ? `${lead.label} and ${extraLive} more still generating`
        : `${lead.label} is still generating`;

  return (
    <div className="sticky top-0 z-30 border-b border-O500/20 bg-O500/10 px-4 py-2 backdrop-blur-md">
      <Link
        href={live.length > 1 ? "/dashboard/assets" : lead.href}
        className="mx-auto flex max-w-5xl items-center justify-center gap-2 text-sm text-O900 hover:text-white"
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span>{copy}</span>
        <span className="text-brand-primary/80">View</span>
      </Link>
    </div>
  );
}
