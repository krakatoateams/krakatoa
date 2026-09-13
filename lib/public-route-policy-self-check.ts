import {
  isLoggedOutPublicAppRoute,
  loggedOutAuthRedirectUrl,
  requestedPathWithSearch,
} from "./public-route-policy";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`public-route-policy self-check: ${message}`);
}

export function publicRoutePolicySelfCheck(): void {
  for (const path of [
    "/dashboard",
    "/tools/photo",
    "/tools/photo-v2",
    "/tools/scheduler",
    "/tools/scheduler/calendar",
    "/tools/video",
    "/tools/canvas",
    "/tools/editor",
    "/tools/skills",
    "/tools/skills/change-background",
  ]) {
    assert(isLoggedOutPublicAppRoute(path), `${path} must render logged-out`);
  }

  for (const path of [
    "/dashboard/assets",
    "/dashboard/settings",
    "/admin",
    "/admin/monitoring",
    "/tools/unknown",
  ]) {
    assert(!isLoggedOutPublicAppRoute(path), `${path} must require sign-in`);
  }

  assert(
    requestedPathWithSearch("/dashboard/settings", "?tab=connections") ===
      "/dashboard/settings?tab=connections",
    "protected deep links must preserve their query across sign-in",
  );
  assert(
    requestedPathWithSearch("/admin", "") === "/admin",
    "query-free protected paths must remain unchanged",
  );

  const redirect = loggedOutAuthRedirectUrl(
    new URL(
      "https://www.kelolako.com/dashboard/settings?tab=connections",
    ),
  );
  assert(
    redirect.toString() ===
      "https://www.kelolako.com/dashboard?authRequired=1&next=%2Fdashboard%2Fsettings%3Ftab%3Dconnections",
    "the dashboard bounce must nest the protected query only inside next",
  );
}

publicRoutePolicySelfCheck();
console.log("public-route-policy self-check passed");
