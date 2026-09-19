export type MissingField =
  | "platforms"
  | "tiktokPrivacy"
  | "tiktokBlocked"
  | "tiktokDuration"
  | "tiktokDisclosure"
  | "media"
  | "title"
  | "date"
  | "time"
  | "tiktokConsent"
  | "alreadyPosted";

export interface ScheduleValidationInput {
  hasMedia: boolean;
  title: string;
  date: string;
  time: string;
  platformCount: number;
  pendingPlatformCount: number;
  targetsTikTok: boolean;
  tiktokPrivacyLevel: string | null;
  tiktokNotBlocked: boolean;
  tiktokDurationOk: boolean;
  tiktokDiscloseComplete: boolean;
  tiktokConsentOk: boolean;
}

export const MISSING_FIELD_MESSAGES: Record<MissingField, string> = {
  platforms: "Select at least one platform",
  tiktokPrivacy: "Choose a TikTok privacy level",
  tiktokBlocked: "This TikTok account can't publish right now",
  tiktokDuration: "Video is too long for TikTok",
  tiktokDisclosure: "Choose how this content is disclosed on TikTok",
  media: "Add a photo or video",
  title: "Add a title",
  date: "Choose a date",
  time: "Choose a time",
  tiktokConsent: "Agree to TikTok's terms to schedule",
  alreadyPosted: "All selected platforms have already been posted",
};

export function getMissingFields(input: ScheduleValidationInput): MissingField[] {
  const missing: MissingField[] = [];

  if (input.platformCount === 0) {
    missing.push("platforms");
  } else if (input.pendingPlatformCount === 0) {
    missing.push("alreadyPosted");
  }

  if (input.targetsTikTok) {
    if (!input.tiktokPrivacyLevel) missing.push("tiktokPrivacy");
    if (!input.tiktokNotBlocked) missing.push("tiktokBlocked");
    if (!input.tiktokDurationOk) missing.push("tiktokDuration");
    if (!input.tiktokDiscloseComplete) missing.push("tiktokDisclosure");
  }

  if (!input.hasMedia) missing.push("media");
  if (!input.title.trim()) missing.push("title");
  if (!input.date) missing.push("date");
  if (!input.time) missing.push("time");

  if (input.targetsTikTok && !input.tiktokConsentOk) missing.push("tiktokConsent");

  return missing;
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
}

const BASE: ScheduleValidationInput = {
  hasMedia: true,
  title: "My video",
  date: "2026-01-01",
  time: "18:00",
  platformCount: 1,
  pendingPlatformCount: 1,
  targetsTikTok: false,
  tiktokPrivacyLevel: null,
  tiktokNotBlocked: true,
  tiktokDurationOk: true,
  tiktokDiscloseComplete: true,
  tiktokConsentOk: true,
};

export function scheduleValidationSelfCheck(): void {
  assertEqual(getMissingFields(BASE), [], "fully valid non-tiktok post has no missing fields");
  assertEqual(getMissingFields({ ...BASE, hasMedia: false }), ["media"], "missing media");
  assertEqual(getMissingFields({ ...BASE, title: "  " }), ["title"], "blank title counts as missing");
  assertEqual(getMissingFields({ ...BASE, date: "" }), ["date"], "missing date");
  assertEqual(getMissingFields({ ...BASE, time: "" }), ["time"], "missing time");
  assertEqual(getMissingFields({ ...BASE, platformCount: 0 }), ["platforms"], "no platform selected");
  assertEqual(
    getMissingFields({ ...BASE, platformCount: 1, pendingPlatformCount: 0 }),
    ["alreadyPosted"],
    "selected platform already succeeded",
  );
  assertEqual(
    getMissingFields({ ...BASE, hasMedia: false, title: "" }),
    ["media", "title"],
    "multiple missing fields all reported at once, in visual order",
  );

  // TikTok-specific checks only apply when targetsTikTok is true.
  const tiktokBase: ScheduleValidationInput = { ...BASE, targetsTikTok: true, tiktokPrivacyLevel: "PUBLIC_TO_EVERYONE" };
  assertEqual(getMissingFields(tiktokBase), [], "fully valid tiktok post has no missing fields");
  assertEqual(
    getMissingFields({ ...BASE, targetsTikTok: true, tiktokPrivacyLevel: null }),
    ["tiktokPrivacy"],
    "tiktok targeted without a chosen privacy level",
  );
  assertEqual(getMissingFields({ ...tiktokBase, tiktokNotBlocked: false }), ["tiktokBlocked"], "tiktok account blocked");
  assertEqual(getMissingFields({ ...tiktokBase, tiktokDurationOk: false }), ["tiktokDuration"], "tiktok duration too long");
  assertEqual(getMissingFields({ ...tiktokBase, tiktokDiscloseComplete: false }), ["tiktokDisclosure"], "tiktok disclosure incomplete");
  assertEqual(getMissingFields({ ...tiktokBase, tiktokConsentOk: false }), ["tiktokConsent"], "tiktok consent unchecked");
  assertEqual(
    getMissingFields({ ...BASE, targetsTikTok: true, tiktokPrivacyLevel: null, tiktokConsentOk: false }),
    ["tiktokPrivacy", "tiktokConsent"],
    "multiple tiktok fields missing at once, in visual order (privacy field renders above the consent checkbox)",
  );
  // Non-tiktok posts never report tiktok-specific fields even if those flags happen to be false.
  assertEqual(
    getMissingFields({ ...BASE, targetsTikTok: false, tiktokNotBlocked: false, tiktokConsentOk: false }),
    [],
    "tiktok flags ignored when tiktok isn't a targeted platform",
  );
}

if (require.main === module) {
  scheduleValidationSelfCheck();
  console.log("scheduleValidationSelfCheck: ok");
}
