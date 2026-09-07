import { getToolConfig } from "@/lib/tool-access";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getCurrentProfile } from "@/lib/profiles-db";
import { canPreviewComingSoon } from "@/lib/tool-preview-access-db";
import { ComingSoonPlaceholder } from "@/components/tools/ComingSoonPlaceholder";

export const dynamic = "force-dynamic";

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  const [config, admin, profile] = await Promise.all([
    getToolConfig("editor"),
    getCurrentAdmin(),
    getCurrentProfile(),
  ]);
  const canBypass = !!admin || (await canPreviewComingSoon(profile?.email));

  if (config?.coming_soon && !canBypass) {
    return (
      <ComingSoonPlaceholder
        toolName="Editor"
        description="A timeline to trim, stitch, and layer clips from your library — still being finished. Check back soon."
      />
    );
  }

  return children;
}
