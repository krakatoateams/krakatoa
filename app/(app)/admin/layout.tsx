import { notFound } from "next/navigation";
import { getCurrentAdmin } from "@/lib/admin-auth";
import AdminNav from "./AdminNav";

/**
 * Server-side admin guard. THIS is the security boundary for every /admin page
 * (the sidebar Admin link is cosmetic only). A non-admin — authenticated or not
 * — gets a 404 (notFound) so the panel's existence is not even revealed.
 *
 * This is a server component nested inside the client (app)/layout.tsx, which is
 * allowed in the Next.js App Router.
 */
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const current = await getCurrentAdmin();
  if (!current) {
    notFound();
  }

  return (
    <div className="px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Admin</h1>
        <p className="mt-1 text-sm text-gray-500">
          Signed in as {current.profile.email} ({current.admin.role})
        </p>
      </div>
      <AdminNav />
      <div className="mt-6">{children}</div>
    </div>
  );
}
