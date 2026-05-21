import { withAuth } from "next-auth/middleware";

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
