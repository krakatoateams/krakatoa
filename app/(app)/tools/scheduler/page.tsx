import { getToolConfig } from "@/lib/tool-access";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getCurrentProfile } from "@/lib/profiles-db";
import { canPreviewComingSoon } from "@/lib/tool-preview-access-db";
import { ComingSoonPlaceholder } from "@/components/tools/ComingSoonPlaceholder";
import SchedulerDashboardPage from "./SchedulerPageClient";

/**
 * Server-side coming_soon gate — the actual access boundary (the sidebar/
 * dashboard badge is cosmetic only). Two ways to bypass it: an admin always
 * sees the real page, or a specific email on the narrow tool_preview_access
 * allowlist (e.g. an external reviewer's test account) — that second path
 * grants ONLY this bypass, not admin panel access. Everyone else, logged in
 * or not, sees a placeholder while tool_configs.coming_soon is true for
 * "schedule". See ComingSoonPlaceholder and kelolako-backlog-8item-checklist
 * memory.
 */
export const dynamic = "force-dynamic";

export default async function SchedulerPage() {
  const [config, admin, profile] = await Promise.all([
    getToolConfig("schedule"),
    getCurrentAdmin(),
    getCurrentProfile(),
  ]);
  const canBypass = !!admin || (await canPreviewComingSoon(profile?.email));

  if (config?.coming_soon && !canBypass) {
  return (
      <ComingSoonPlaceholder
        toolName="Schedule"
        description="Plan and auto-publish your posts to YouTube and TikTok — this is still being finished. Check back soon."
      />
    );
  }

  return <SchedulerDashboardPage />;
}
