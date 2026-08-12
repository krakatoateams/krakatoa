import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Inter } from "next/font/google";
import { DesignSystemSidebar } from "./DesignSystemSidebar";

// Lives here rather than in page.tsx because the page is a Client Component
// (it renders interactive Button state previews) — `metadata` exports are
// only valid from Server Components.
export const metadata: Metadata = {
  title: "Kelolako Design System",
  robots: { index: false, follow: false },
};

// Scoped to this route only — deliberately not added to the root
// app/layout.tsx. The app's live --font-body is DM Sans; Inter is the new
// Kelolako design-system body font and has no cutover decision yet, so it
// stays isolated here until the broader rebrand rollout happens.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ds-body",
  weight: ["400", "600", "700"],
});

/**
 * Internal-only gate: 404s in production so the style guide's existence
 * isn't discoverable, same pattern as app/(app)/admin/layout.tsx.
 */
export default function DesignSystemLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <div className={`${inter.variable} font-ds-body min-h-screen bg-bg-base text-text-primary`}>
      <div className="mx-auto flex max-w-7xl gap-spacing-xxl px-spacing-xl py-spacing-xxl">
        <DesignSystemSidebar />
        <main className="min-w-0 flex-1 space-y-spacing-6xl">{children}</main>
      </div>
    </div>
  );
}
