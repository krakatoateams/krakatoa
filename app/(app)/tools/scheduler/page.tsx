import { getToolConfig } from "@/lib/tool-access";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { ComingSoonPlaceholder } from "@/components/tools/ComingSoonPlaceholder";
import SchedulerDashboardPage from "./SchedulerPageClient";

/**
 * Server-side coming_soon gate — the actual access boundary (the sidebar/
 * dashboard badge is cosmetic only). An admin bypasses it and always sees
 * the real page; everyone else, logged in or not, sees a placeholder while
 * tool_configs.coming_soon is true for "schedule". See
 * ComingSoonPlaceholder and kelolako-backlog-8item-checklist memory.
 */
export const dynamic = "force-dynamic";

export default async function SchedulerPage() {
  const [config, admin] = await Promise.all([getToolConfig("schedule"), getCurrentAdmin()]);

  if (config?.coming_soon && !admin) {
    return (
      <ComingSoonPlaceholder
        toolName="Schedule"
        description="Plan and auto-publish your posts to YouTube and TikTok — this is still being finished. Check back soon."
      />
    );
  }

  return <SchedulerDashboardPage />;
}
