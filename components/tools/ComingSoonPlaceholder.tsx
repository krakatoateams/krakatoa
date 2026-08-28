import Link from "next/link";
import { Clock, ArrowLeft } from "lucide-react";
import PageContainer from "@/app/(app)/dashboard/PageContainer";

/**
 * Real access gate, not just a badge — rendered instead of the actual tool
 * page for a non-admin visitor when tool_configs.coming_soon is true (see
 * app/(app)/tools/scheduler/page.tsx and .../calendar/page.tsx). An admin
 * bypasses this entirely and sees the real page (getCurrentAdmin() check in
 * each server wrapper) — see kelolako-backlog-8item-checklist memory for why
 * this replaced the earlier badge-only, non-blocking design.
 */
export function ComingSoonPlaceholder({
  toolName,
  description,
}: {
  toolName: string;
  description?: string;
}) {
  return (
    <PageContainer>
      <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-warning/30 bg-warning/10">
          <Clock className="h-6 w-6 text-warning" />
        </div>
        <span className="mb-3 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-warning">
          Coming Soon
        </span>
        <h1 className="font-display text-xl font-bold text-text-primary">{toolName}</h1>
        <p className="mt-2 max-w-sm text-body-3 text-text-secondary">
          {description ?? "We're still putting the finishing touches on this feature. Check back soon."}
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center gap-2 rounded-radius-xl border border-white/10 bg-white/10 px-4 py-2.5 text-body-3 font-medium text-text-primary transition-colors hover:bg-white/20"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </div>
    </PageContainer>
  );
}
