/**
 * Legacy /calendar navbar must not treat a Krakatoa login as a YouTube
 * connection. YouTube is a separate platform_tokens row.
 */

import { readFileSync } from "node:fs";

export type LegacyCalendarYoutubeBadge =
  | "signed-out"
  | "youtube-connected"
  | "youtube-disconnected";

export function legacyCalendarYoutubeBadge(input: {
  authenticated: boolean;
  youtubeConnected: boolean;
}): LegacyCalendarYoutubeBadge {
  if (!input.authenticated) return "signed-out";
  return input.youtubeConnected ? "youtube-connected" : "youtube-disconnected";
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`legacy-calendar-badge self-check: ${message}`);
}

export function legacyCalendarBadgeSelfCheck(): void {
  assert(
    legacyCalendarYoutubeBadge({ authenticated: true, youtubeConnected: false }) ===
      "youtube-disconnected",
    "a Krakatoa login without a YouTube token must not show YouTube Connected",
  );
  assert(
    legacyCalendarYoutubeBadge({ authenticated: true, youtubeConnected: true }) ===
      "youtube-connected",
    "a YouTube platform connection must show YouTube Connected",
  );
  assert(
    legacyCalendarYoutubeBadge({ authenticated: false, youtubeConnected: false }) ===
      "signed-out",
    "signed-out users must see the sign-in CTA",
  );

  const nextConfig = readFileSync(
    new URL("../next.config.mjs", import.meta.url),
    "utf8",
  );
  assert(
    /source:\s*"\/calendar"/.test(nextConfig) &&
      /destination:\s*"\/tools\/scheduler\/calendar"/.test(nextConfig) &&
      /permanent:\s*true/.test(nextConfig),
    "/calendar must permanently redirect to /tools/scheduler/calendar",
  );
}

if (require.main === module) {
  legacyCalendarBadgeSelfCheck();
  console.log("legacy-calendar-badge self-check passed");
}
