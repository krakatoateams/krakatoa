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
export function isPlatformUsable(enabled: boolean, canBypass: boolean): boolean {
  return enabled || canBypass;
}

/**
 * Which badge (if any) a coming-soon platform's checkbox/connect-button
 * should show. "none" when the platform is enabled for everyone; "preview"
 * only for a bypassed caller (admin, or a platform-scoped preview grant)
 * viewing a disabled platform, so they don't forget mid-testing that regular
 * users can't see this yet; "soon" for everyone else.
 */
export function platformBadge(enabled: boolean, canBypass: boolean): PlatformBadge {
  if (enabled) return "none";
  return canBypass ? "preview" : "soon";
}

/**
 * When exactly one platform is selectable at all (see CONTEXT.md: this is
 * the common case once the others are coming-soon, or simply not yet
 * connected), the caller should skip the platform chooser entirely and
 * auto-select it — asking someone to "choose" between one real option and
 * nothing is a choice they never actually have. Returns null when zero or
 * more than one platform is selectable, since both cases genuinely need the
 * normal chooser (nothing to auto-select, or a real decision to make).
 */
export function soleSelectablePlatform(selectable: Partial<Record<Platform, boolean>>): Platform | null {
  const list = (Object.keys(selectable) as Platform[]).filter((p) => selectable[p]);
  return list.length === 1 ? list[0] : null;
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

  assertEqual(soleSelectablePlatform({ tiktok: true }), "tiktok", "exactly one selectable platform is returned");
  assertEqual(
    soleSelectablePlatform({ tiktok: true, instagram: false, youtube: false }),
    "tiktok",
    "false entries don't count, only one true entry",
  );
  assertEqual(
    soleSelectablePlatform({ tiktok: true, instagram: true }),
    null,
    "two selectable platforms means a real choice — no auto-select",
  );
  assertEqual(soleSelectablePlatform({}), null, "no platforms at all — nothing to auto-select");
  assertEqual(soleSelectablePlatform({ tiktok: false }), null, "zero selectable platforms — nothing to auto-select");
}

if (require.main === module) {
  platformAvailabilitySelfCheck();
  console.log("platformAvailabilitySelfCheck: ok");
}
