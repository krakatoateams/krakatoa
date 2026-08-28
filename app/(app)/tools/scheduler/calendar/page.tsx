import { getToolConfig } from "@/lib/tool-access";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { ComingSoonPlaceholder } from "@/components/tools/ComingSoonPlaceholder";
import SchedulerCalendarPage from "./CalendarPageClient";

/**
 * Server-side coming_soon gate for "calendar" — independent from Schedule's
 * own "schedule" flag (separate tool_configs rows, separately toggleable).
 * See the matching comment on ../page.tsx.
 */
export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const [config, admin] = await Promise.all([getToolConfig("calendar"), getCurrentAdmin()]);

  if (config?.coming_soon && !admin) {
    return (
      <ComingSoonPlaceholder
        toolName="Calendar"
        description="See all your scheduled and published posts in one calendar view — this is still being finished. Check back soon."
      />
    );
  }

  return <SchedulerCalendarPage />;
}
