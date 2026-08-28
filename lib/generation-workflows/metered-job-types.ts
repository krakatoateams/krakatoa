/**
 * Every metered generation route job_type. Used for workflow rollout flags and
 * self-checks — keep in sync with active-generations-pure JOB_TYPE_SPEC keys.
 */
export const METERED_JOB_TYPES = [
  "product_photo",
  "storyboard_image",
  "storyboard_import",
  "storyboard_video",
  "video_text2video",
  "video_image2video",
  "video_motion_control",
  "reels_seedance",
  "veo_single",
  "veo_perscene",
] as const;

export type MeteredJobType = (typeof METERED_JOB_TYPES)[number];

const METERED_JOB_TYPE_SET = new Set<string>(METERED_JOB_TYPES);

export function isMeteredJobType(jobType: string): jobType is MeteredJobType {
  return METERED_JOB_TYPE_SET.has(jobType);
}
