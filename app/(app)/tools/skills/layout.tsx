import { getToolConfig } from "@/lib/tool-access";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getCurrentProfile } from "@/lib/profiles-db";
import { canPreviewComingSoon } from "@/lib/tool-preview-access-db";
import { ComingSoonPlaceholder } from "@/components/tools/ComingSoonPlaceholder";

export const dynamic = "force-dynamic";

export default async function SkillsLayout({ children }: { children: React.ReactNode }) {
  const [config, admin, profile] = await Promise.all([
    getToolConfig("skills"),
    getCurrentAdmin(),
    getCurrentProfile(),
  ]);
  const canBypass = !!admin || (await canPreviewComingSoon(profile?.email));

  if (config?.coming_soon && !canBypass) {
    return (
      <ComingSoonPlaceholder
        toolName="Skills"
        description="Focused recipes like change background, change character, and cinematic film — still being finished. Check back soon."
      />
    );
  }

  return children;
}
