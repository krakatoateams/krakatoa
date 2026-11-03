/**
 * Last-used scheduling settings, prefilled on the next new post (#494).
 *
 * Only settings no platform rule forbids prefilling are part of this shape.
 * TikTok privacy, Allow Comment/Duet/Stitch, content disclosure and the music
 * consent must start empty on every post (TikTok UX guidelines; tiktok-publish
 * design Decisions 4/4a), so they are deliberately NOT fields here — they
 * can't be remembered by construction. Format is per-video (auto-suggested
 * from duration/aspect), so it isn't remembered either.
 *
 * Stored per user in localStorage (a per-device convenience; losing it only
 * means the defaults come back).
 */

export type SchedulePlatform = "youtube" | "tiktok" | "instagram";
export type YouTubePrivacy = "public" | "unlisted" | "private";
export type CaptionMode = "individual" | "same";

export interface SchedulePreferences {
  /** Platforms of the last scheduled video post. */
  platforms: SchedulePlatform[];
  youtubePrivacyStatus: YouTubePrivacy;
  captionMode: CaptionMode;
}

const PLATFORMS: readonly SchedulePlatform[] = ["youtube", "tiktok", "instagram"];
const YOUTUBE_PRIVACY: readonly YouTubePrivacy[] = ["public", "unlisted", "private"];
const CAPTION_MODES: readonly CaptionMode[] = ["individual", "same"];

export function schedulePreferencesKey(userId: string): string {
  return `kelolako:schedule-prefs:v1:${userId}`;
}

/** Validates stored JSON; anything malformed or unknown is dropped, never trusted. */
export function parseSchedulePreferences(raw: string | null): SchedulePreferences | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const platforms = Array.isArray(obj.platforms)
    ? PLATFORMS.filter((p) => (obj.platforms as unknown[]).includes(p))
    : [];
  const youtubePrivacyStatus = YOUTUBE_PRIVACY.includes(obj.youtubePrivacyStatus as YouTubePrivacy)
    ? (obj.youtubePrivacyStatus as YouTubePrivacy)
    : "public";
  const captionMode = CAPTION_MODES.includes(obj.captionMode as CaptionMode)
    ? (obj.captionMode as CaptionMode)
    : "individual";
  return { platforms, youtubePrivacyStatus, captionMode };
}

/**
 * What to remember after a successful schedule. A photo post is TikTok-only
 * by force, so it must not overwrite the platforms the user picks for videos.
 */
export function nextSchedulePreferences(
  previous: SchedulePreferences | null,
  scheduled: {
    contentType: "video" | "photo";
    platforms: SchedulePlatform[];
    youtubePrivacyStatus: YouTubePrivacy;
    captionMode: CaptionMode;
  },
): SchedulePreferences {
  const platforms =
    scheduled.contentType === "photo"
      ? previous?.platforms ?? []
      : PLATFORMS.filter((p) => scheduled.platforms.includes(p));
  return {
    platforms,
    youtubePrivacyStatus: scheduled.youtubePrivacyStatus,
    captionMode: scheduled.captionMode,
  };
}

/** Platforms for a newly added video card: remembered ones, else the old YouTube default. */
export function videoPlatformsFromPreferences(prefs: SchedulePreferences | null): SchedulePlatform[] {
  return prefs && prefs.platforms.length > 0 ? [...prefs.platforms] : ["youtube"];
}

export function schedulePreferencesSelfCheck(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
  };

  assert(parseSchedulePreferences(null) === null, "missing value must be null");
  assert(parseSchedulePreferences("{not json") === null, "corrupt value must be null");

  const parsed = parseSchedulePreferences(
    JSON.stringify({
      platforms: ["tiktok", "youtube", "myspace"],
      youtubePrivacyStatus: "unlisted",
      captionMode: "same",
      tiktokPrivacyLevel: "PUBLIC_TO_EVERYONE",
    }),
  );
  assert(!!parsed, "valid value must parse");
  assert(parsed!.platforms.join(",") === "youtube,tiktok", "unknown platforms dropped, canonical order");
  assert(parsed!.youtubePrivacyStatus === "unlisted", "youtube privacy kept");
  assert(parsed!.captionMode === "same", "caption mode kept");
  assert(!("tiktokPrivacyLevel" in parsed!), "TikTok privacy must never be carried over");

  const bad = parseSchedulePreferences(JSON.stringify({ youtubePrivacyStatus: "secret", captionMode: 3 }));
  assert(bad!.youtubePrivacyStatus === "public" && bad!.captionMode === "individual", "bad values fall back to defaults");

  const prev = { platforms: ["youtube", "tiktok"] as SchedulePlatform[], youtubePrivacyStatus: "public" as const, captionMode: "individual" as const };
  const afterPhoto = nextSchedulePreferences(prev, {
    contentType: "photo",
    platforms: ["tiktok"],
    youtubePrivacyStatus: "private",
    captionMode: "individual",
  });
  assert(afterPhoto.platforms.join(",") === "youtube,tiktok", "a photo post must not overwrite video platforms");
  const afterVideo = nextSchedulePreferences(prev, {
    contentType: "video",
    platforms: ["tiktok"],
    youtubePrivacyStatus: "unlisted",
    captionMode: "same",
  });
  assert(afterVideo.platforms.join(",") === "tiktok", "a video post updates platforms");

  assert(videoPlatformsFromPreferences(null).join(",") === "youtube", "no prefs keeps the YouTube default");
  assert(videoPlatformsFromPreferences({ ...prev, platforms: [] }).join(",") === "youtube", "empty prefs keep the default");
  assert(videoPlatformsFromPreferences(prev).join(",") === "youtube,tiktok", "remembered platforms are used");
}

if (require.main === module) {
  schedulePreferencesSelfCheck();
  console.log("schedulePreferencesSelfCheck: ok");
}
