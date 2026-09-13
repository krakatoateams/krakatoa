const LOGGED_OUT_PUBLIC_APP_ROUTES = new Set([
  "/dashboard",
  "/tools/photo",
  "/tools/photo-v2",
  "/tools/scheduler",
  "/tools/scheduler/calendar",
  "/tools/video",
  "/tools/canvas",
  "/tools/editor",
  "/tools/skills",
]);

export function isLoggedOutPublicAppRoute(pathname: string): boolean {
  return (
    LOGGED_OUT_PUBLIC_APP_ROUTES.has(pathname) ||
    pathname.startsWith("/tools/skills/")
  );
}

export function requestedPathWithSearch(
  pathname: string,
  search: string,
): string {
  return `${pathname}${search}`;
}

export function loggedOutAuthRedirectUrl(requestUrl: URL): URL {
  const redirect = new URL("/dashboard", requestUrl);
  redirect.searchParams.set("authRequired", "1");
  redirect.searchParams.set(
    "next",
    requestedPathWithSearch(requestUrl.pathname, requestUrl.search),
  );
  return redirect;
}
