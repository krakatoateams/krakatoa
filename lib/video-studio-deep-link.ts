import {
  getViralTemplate,
  isViralTemplateId,
  TRENDING_TEMPLATES,
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROMPT_MAX_CHARS = 4_000;

function uuidParam(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return UUID_RE.test(trimmed) ? trimmed : null;
}

function promptParam(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.slice(0, PROMPT_MAX_CHARS) : null;
}

function videoCreationTypeParam(value: string | null): VideoCreationType | null {
  switch (value) {
    case "text2video":
    case "image2video":
    case "viral_template":
    case "motion_control":
    case "storyboard":
    case "reels-creator":
      return value;
    default:
      return null;
  }
}

/** Read search params once on mount — switching modes in the UI must not rewrite the URL. */
export function parseVideoStudioDeepLink(
  searchParams: Pick<URLSearchParams, "get">
): VideoStudioDeepLink {
  const typeParam = searchParams.get("type");
  const parsedType = videoCreationTypeParam(typeParam);
  const initialType = parsedType ?? "text2video";
  const queryType = typeParam === null || parsedType ? initialType : null;
  const initialStoryboardId =
    queryType === "storyboard"
      ? uuidParam(searchParams.get("storyboardId"))
      : null;
  const initialStartImageCreationId =
    queryType === "image2video"
      ? uuidParam(searchParams.get("startImageCreationId"))
      : null;
  const templateVideoParam = searchParams.get("templateVideo")?.trim() ?? "";
  const initialTemplateVideo =
    queryType === "motion_control" &&
    TRENDING_TEMPLATES.some((template) => template.videoUrl === templateVideoParam)
      ? templateVideoParam
      : null;
  const initialViralTemplateId = searchParams.get("viralTemplate");
  const initialViralTemplate =
    queryType === "viral_template" &&
    initialViralTemplateId &&
    isViralTemplateId(initialViralTemplateId)
      ? (getViralTemplate(initialViralTemplateId) ?? null)
      : null;
  const initialPrompt =
    queryType === "text2video" || queryType === "image2video"
      ? promptParam(searchParams.get("prompt"))
      : null;

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
  const storyboardId = "11111111-1111-4111-8111-111111111111";
  const creationId = "22222222-2222-4222-8222-222222222222";
  const motionTemplateUrl =
    "https://cdn.kelolako.com/trending-template-1/kelolako_motion1.webm";

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
  const unknownType = parseVideoStudioDeepLink(
    params({
      type: "unknown",
      prompt: "must not leak into fallback",
      startImageCreationId: creationId,
      templateVideo: motionTemplateUrl,
    })
  );
  assert(
    unknownType.initialPrompt === null &&
      unknownType.initialStartImageCreationId === null &&
      unknownType.initialTemplateVideo === null,
    "unknown type rejects associated query parameters"
  );

  const sb = parseVideoStudioDeepLink(
    params({ type: "storyboard", storyboardId })
  );
  assert(sb.initialStoryboardId === storyboardId, "valid storyboardId");
  assert(
    parseVideoStudioDeepLink(
      params({ type: "storyboard", storyboardId: "not-a-uuid" })
    ).initialStoryboardId === null,
    "invalid storyboardId"
  );
  assert(
    parseVideoStudioDeepLink(
      params({ type: "text2video", storyboardId })
    ).initialStoryboardId === null,
    "storyboardId is scoped to storyboard type"
  );

  const i2v = parseVideoStudioDeepLink(
    params({ type: "image2video", startImageCreationId: creationId, prompt: " wave " })
  );
  assert(i2v.initialStartImageCreationId === creationId, "valid startImageCreationId");
  assert(i2v.initialPrompt === "wave", "prompt on image2video");
  assert(
    parseVideoStudioDeepLink(
      params({ type: "image2video", startImageCreationId: "not-a-uuid" })
    ).initialStartImageCreationId === null,
    "invalid startImageCreationId"
  );
  assert(
    parseVideoStudioDeepLink(
      params({ type: "text2video", startImageCreationId: creationId })
    ).initialStartImageCreationId === null,
    "startImageCreationId is scoped to image2video type"
  );

  const t2v = parseVideoStudioDeepLink(params({ type: "text2video", prompt: " sunset " }));
  assert(t2v.initialPrompt === "sunset", "prompt on text2video");
  assert(
    parseVideoStudioDeepLink(
      params({ type: "text2video", prompt: "x".repeat(4_100) })
    ).initialPrompt?.length === 4_000,
    "prompt is bounded"
  );
  assert(
    parseVideoStudioDeepLink(
      params({ type: "motion_control", prompt: "ignored" })
    ).initialPrompt === null,
    "prompt is scoped to prompt-based types"
  );

  const mc = parseVideoStudioDeepLink(
    params({ type: "motion_control", templateVideo: motionTemplateUrl })
  );
  assert(mc.initialTemplateVideo === motionTemplateUrl, "catalog templateVideo");
  assert(
    parseVideoStudioDeepLink(
      params({ type: "motion_control", templateVideo: "https://example.com/t.mp4" })
    ).initialTemplateVideo === null,
    "non-catalog templateVideo"
  );
  assert(
    parseVideoStudioDeepLink(
      params({ type: "text2video", templateVideo: motionTemplateUrl })
    ).initialTemplateVideo === null,
    "templateVideo is scoped to motion_control type"
  );

  const vt = parseVideoStudioDeepLink(params({ type: "viral_template", viralTemplate: "not-real" }));
  assert(vt.initialViralTemplate === null, "invalid viralTemplate id");

  const vtOk = parseVideoStudioDeepLink(
    params({ type: "viral_template", viralTemplate: "kelolako_viral_videos_00001.mp4" })
  );
  assert(vtOk.initialViralTemplate?.id === "kelolako_viral_videos_00001.mp4", "valid viralTemplate id");
  assert(
    parseVideoStudioDeepLink(
      params({ type: "text2video", viralTemplate: "kelolako_viral_videos_00001.mp4" })
    ).initialViralTemplate === null,
    "viralTemplate is scoped to viral_template type"
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  videoStudioDeepLinkSelfCheck();
  console.log("video-studio-deep-link self-check passed");
}
