/**
 * Platform availability (see CONTEXT.md): a single per-platform flag,
 * product-wide, that governs both connecting the account (Settings) and
 * selecting it in Schedule — distinct from the existing tool-level
 * "coming soon" (lib/admin-config-tree.ts's tool_configs), which is purely
 * cosmetic and never blocks anyone. This one actually blocks non-admins;
 * admins get a full "Admin preview" bypass instead of the normal "Soon" lock.
 */

export type Platform = "tiktok" | "instagram" | "youtube";
export type PlatformBadge = "none" | "soon" | "preview";

/** Whether the given caller may actually use this platform right now. */
export function isPlatformUsable(enabled: boolean, isAdmin: boolean): boolean {
  return enabled || isAdmin;
}

/**
 * Which badge (if any) a coming-soon platform's checkbox/connect-button
 * should show. "none" when the platform is enabled for everyone; "preview"
 * only for an admin viewing a disabled platform (so they don't forget mid-
 * testing that regular users can't see this yet); "soon" for everyone else.
 */
export function platformBadge(enabled: boolean, isAdmin: boolean): PlatformBadge {
  if (enabled) return "none";
  return isAdmin ? "preview" : "soon";
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
}

export function platformAvailabilitySelfCheck(): void {
  assertEqual(isPlatformUsable(true, false), true, "enabled platform usable by a regular user");
  assertEqual(isPlatformUsable(false, false), false, "disabled platform NOT usable by a regular user");
  assertEqual(isPlatformUsable(false, true), true, "disabled platform usable by an admin (the bypass)");
  assertEqual(isPlatformUsable(true, true), true, "enabled platform usable by an admin too");

  assertEqual(platformBadge(true, false), "none", "enabled platform shows no badge for a regular user");
  assertEqual(platformBadge(true, true), "none", "enabled platform shows no badge for an admin either");
  assertEqual(platformBadge(false, false), "soon", "disabled platform shows Soon for a regular user");
  assertEqual(platformBadge(false, true), "preview", "disabled platform shows Preview for an admin");
}

if (require.main === module) {
  platformAvailabilitySelfCheck();
  console.log("platformAvailabilitySelfCheck: ok");
}
