import { getToolConfig } from "@/lib/tool-access";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getCurrentProfile } from "@/lib/profiles-db";
import { canPreviewComingSoon } from "@/lib/tool-preview-access-db";
import { ComingSoonPlaceholder } from "@/components/tools/ComingSoonPlaceholder";
import SchedulerCalendarPage from "./CalendarPageClient";

/**
 * Server-side coming_soon gate for "calendar" — independent from Schedule's
 * own "schedule" flag (separate tool_configs rows, separately toggleable).
 * See the matching comment on ../page.tsx re: the tool_preview_access bypass.
 */
export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const [config, admin, profile] = await Promise.all([
    getToolConfig("calendar"),
    getCurrentAdmin(),
    getCurrentProfile(),
  ]);
  const canBypass = !!admin || (await canPreviewComingSoon(profile?.email));

  if (config?.coming_soon && !canBypass) {
    return (
      <ComingSoonPlaceholder
        toolName="Calendar"
        description="See all your scheduled and published posts in one calendar view — this is still being finished. Check back soon."
      />
    );
  }

  return <SchedulerCalendarPage />;
}
