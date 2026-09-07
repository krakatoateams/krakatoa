import {
  getViralTemplate,
  isViralTemplateId,
  type TrendingTemplate,
} from "./trending-templates";

export type VideoCreationType =
  | "text2video"
  | "image2video"
  | "viral_template"
  | "motion_control"
  | "storyboard"
  | "reels-creator";

export type VideoStudioDeepLink = {
  initialType: VideoCreationType;
  initialStoryboardId: string | null;
  initialStartImageCreationId: string | null;
  initialTemplateVideo: string | null;
  initialViralTemplate: TrendingTemplate | null;
  initialPrompt: string | null;
};

/** Read search params once on mount — switching modes in the UI must not rewrite the URL. */
export function parseVideoStudioDeepLink(
  searchParams: Pick<URLSearchParams, "get">
): VideoStudioDeepLink {
  const typeParam = searchParams.get("type");
  const initialType: VideoCreationType =
    typeParam === "storyboard"
      ? "storyboard"
      : typeParam === "viral_template"
        ? "viral_template"
        : typeParam === "motion_control"
          ? "motion_control"
          : typeParam === "image2video"
            ? "image2video"
            : typeParam === "reels-creator"
              ? "reels-creator"
              : "text2video";
  const initialStoryboardId = searchParams.get("storyboardId") || null;
  const initialStartImageCreationId = searchParams.get("startImageCreationId") || null;
  const initialTemplateVideo = searchParams.get("templateVideo") || null;
  const initialViralTemplateId = searchParams.get("viralTemplate");
  const initialViralTemplate =
    initialViralTemplateId && isViralTemplateId(initialViralTemplateId)
      ? (getViralTemplate(initialViralTemplateId) ?? null)
      : null;
  const initialPrompt = searchParams.get("prompt") || null;

  return {
    initialType,
    initialStoryboardId,
    initialStartImageCreationId,
    initialTemplateVideo,
    initialViralTemplate,
    initialPrompt,
  };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`video-studio-deep-link self-check: ${msg}`);
}

function params(input: Record<string, string>): Pick<URLSearchParams, "get"> {
  const sp = new URLSearchParams(input);
  return { get: (k: string) => sp.get(k) };
}

/** ponytail: runnable without React — fails if mount-once parsing drifts. */
export function videoStudioDeepLinkSelfCheck(): void {
  assert(parseVideoStudioDeepLink(params({})).initialType === "text2video", "default type");
  assert(
    parseVideoStudioDeepLink(params({ type: "storyboard" })).initialType === "storyboard",
    "storyboard type"
  );
  assert(
    parseVideoStudioDeepLink(params({ type: "image2video" })).initialType === "image2video",
    "image2video type"
  );
  assert(
    parseVideoStudioDeepLink(params({ type: "viral_template" })).initialType === "viral_template",
    "viral_template type"
  );
  assert(
    parseVideoStudioDeepLink(params({ type: "motion_control" })).initialType === "motion_control",
    "motion_control type"
  );
  assert(
    parseVideoStudioDeepLink(params({ type: "reels-creator" })).initialType === "reels-creator",
    "reels-creator type"
  );
  assert(
    parseVideoStudioDeepLink(params({ type: "unknown" })).initialType === "text2video",
    "unknown type falls back to text2video"
  );

  const sb = parseVideoStudioDeepLink(
    params({ type: "storyboard", storyboardId: "sb-1" })
  );
  assert(sb.initialStoryboardId === "sb-1", "storyboardId");

  const i2v = parseVideoStudioDeepLink(
    params({ type: "image2video", startImageCreationId: "c-9", prompt: "wave" })
  );
  assert(i2v.initialStartImageCreationId === "c-9", "startImageCreationId");
  assert(i2v.initialPrompt === "wave", "prompt on image2video");

  const t2v = parseVideoStudioDeepLink(params({ type: "text2video", prompt: "sunset" }));
  assert(t2v.initialPrompt === "sunset", "prompt on text2video");

  const mc = parseVideoStudioDeepLink(
    params({ type: "motion_control", templateVideo: "https://example.com/t.mp4" })
  );
  assert(mc.initialTemplateVideo === "https://example.com/t.mp4", "templateVideo");

  const vt = parseVideoStudioDeepLink(params({ type: "viral_template", viralTemplate: "not-real" }));
  assert(vt.initialViralTemplate === null, "invalid viralTemplate id");

  const vtOk = parseVideoStudioDeepLink(
    params({ type: "viral_template", viralTemplate: "kelolako_viral_videos_00001.mp4" })
  );
  assert(vtOk.initialViralTemplate?.id === "kelolako_viral_videos_00001.mp4", "valid viralTemplate id");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  videoStudioDeepLinkSelfCheck();
  console.log("video-studio-deep-link self-check passed");
}
