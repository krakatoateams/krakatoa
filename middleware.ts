import { withAuth } from "next-auth/middleware";

// next-auth's parseUrl() throws `TypeError: Invalid URL` when NEXTAUTH_URL is set
// but empty (""). Normalize before withAuth runs so /tools/* and /dashboard/* work in dev.
(() => {
  const raw = process.env.NEXTAUTH_URL?.trim();
  if (!raw) {
    const vercel = process.env.VERCEL_URL?.trim();
    process.env.NEXTAUTH_URL = vercel
      ? `https://${vercel}`
      : "http://localhost:3000";
    return;
  }
  process.env.NEXTAUTH_URL = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
})();

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
  // sidebar shell and require an authenticated user.
  matcher: ["/dashboard/:path*", "/tools/:path*"],
};
