import { withAuth } from "next-auth/middleware";

// next-auth's parseUrl() throws `TypeError: Invalid URL` when NEXTAUTH_URL is set
// but empty (""). Normalize before withAuth runs so /tools/* and /dashboard/* work in dev.
function normalizeAuthUrl(raw: string | undefined): string {
  if (!raw?.trim()) {
    const vercel = process.env.VERCEL_URL?.trim();
    return vercel ? `https://${vercel}` : "http://localhost:3000";
  }
  let url = raw.trim();
  const markdown = url.match(/\[(https?:\/\/[^\]]+)\]\([^)]*\)/);
  if (markdown) url = markdown[1];
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

process.env.NEXTAUTH_URL = normalizeAuthUrl(process.env.NEXTAUTH_URL);

// Protect the dashboard (and any future routes under it).
// Unauthenticated users are sent to the NextAuth sign-in page,
// which after Google OAuth will redirect them back to /dashboard
// (see the `redirect` callback in lib/auth.ts).
export default withAuth({
  pages: {
    signIn: "/api/auth/signin",
  },
});

export const config = {
  // All routes that live under the (app) route group share the
  // sidebar shell and require an authenticated user. /admin additionally
  // enforces an active-admin check server-side in app/(app)/admin/layout.tsx
  // (withAuth here only guarantees the user is signed in).
  matcher: ["/dashboard/:path*", "/tools/:path*", "/admin/:path*"],
};
