/**
 * Legacy /calendar navbar must not treat a Krakatoa login as a YouTube
 * connection. YouTube is a separate platform_tokens row.
 */

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
}

if (require.main === module) {
  legacyCalendarBadgeSelfCheck();
  console.log("legacy-calendar-badge self-check passed");
}
