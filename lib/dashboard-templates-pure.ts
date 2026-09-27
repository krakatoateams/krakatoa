import type { TrendingTemplate } from "@/lib/trending-templates";

export type DashboardTemplateKind = "motion_control" | "viral";

export type AdminDashboardTemplate = {
  slug: string;
  kind: DashboardTemplateKind;
  title: string;
  videoUrl: string;
  generationVideoUrl?: string;
  prompt?: string;
  characterThumbUrl?: string;
  referenceImageUrl?: string;
  productThumbUrl?: string;
  skillId?: string;
  shotCount?: number;
  isActive: boolean;
  sortOrder: number;
};

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const HTTPS_URL_RE = /^https:\/\/[^\s<>"']+$/i;

export function isDashboardTemplateKind(value: string): value is DashboardTemplateKind {
  return value === "motion_control" || value === "viral";
}

export function isHttpsMediaUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !HTTPS_URL_RE.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isRelativeAssetPath(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("/") && !trimmed.includes("..");
}

export function isAllowedMediaUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return isHttpsMediaUrl(trimmed) || isRelativeAssetPath(trimmed);
}

export function toTrendingTemplate(row: AdminDashboardTemplate): TrendingTemplate {
  const videoUrl = row.videoUrl.trim();
  const generationVideoUrl = row.generationVideoUrl?.trim();
  return {
    id: row.slug,
    title: row.title.trim() || undefined,
    videoUrl,
    ...(generationVideoUrl && generationVideoUrl !== videoUrl
      ? { generationVideoUrl }
      : {}),
    ...(row.prompt?.trim() ? { prompt: row.prompt.trim() } : {}),
    ...(row.characterThumbUrl?.trim()
      ? { characterImageUrl: row.characterThumbUrl.trim() }
      : {}),
    ...(row.referenceImageUrl?.trim()
      ? { referenceImageUrl: row.referenceImageUrl.trim() }
      : {}),
    ...(row.productThumbUrl?.trim()
      ? { productImageUrl: row.productThumbUrl.trim() }
      : {}),
    ...(row.skillId?.trim() ? { skillId: row.skillId.trim() } : {}),
    ...(typeof row.shotCount === "number" && row.shotCount > 0
      ? { shotCount: row.shotCount }
      : {}),
  };
}

export class DashboardTemplateValidationError extends Error {}

export function parseAdminDashboardTemplate(
  raw: unknown,
  index: number,
  expectedKind: DashboardTemplateKind
): AdminDashboardTemplate {
  if (!raw || typeof raw !== "object") {
    throw new DashboardTemplateValidationError(`Row ${index + 1} is malformed.`);
  }
  const row = raw as Record<string, unknown>;

  const slug = typeof row.slug === "string" ? row.slug.trim() : "";
  if (!SLUG_RE.test(slug)) {
    throw new DashboardTemplateValidationError(
      `Row ${index + 1}: slug must be 1–128 characters (letters, digits, ".", "-", "_").`
    );
  }

  const kind = typeof row.kind === "string" ? row.kind : expectedKind;
  if (!isDashboardTemplateKind(kind) || kind !== expectedKind) {
    throw new DashboardTemplateValidationError(`Row ${index + 1}: invalid carousel kind.`);
  }

  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (kind === "viral" && !title) {
    throw new DashboardTemplateValidationError(`Row "${slug}": title is required for viral templates.`);
  }
  if (title.length > 120) {
    throw new DashboardTemplateValidationError(`Row "${slug}": title is too long.`);
  }

  const videoUrl = typeof row.videoUrl === "string" ? row.videoUrl.trim() : "";
  if (!isAllowedMediaUrl(videoUrl)) {
    throw new DashboardTemplateValidationError(
      `Row "${slug}": preview URL must be an https:// link or site-relative path.`
    );
  }

  const generationVideoUrl =
    typeof row.generationVideoUrl === "string" ? row.generationVideoUrl.trim() : "";
  if (generationVideoUrl && !isAllowedMediaUrl(generationVideoUrl)) {
    throw new DashboardTemplateValidationError(
      `Row "${slug}": generation URL must be an https:// link or site-relative path.`
    );
  }

  const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
  const skillId = typeof row.skillId === "string" ? row.skillId.trim() : "";
  if (kind === "viral" && !skillId && !prompt) {
    throw new DashboardTemplateValidationError(
      `Row "${slug}": viral templates need a generation prompt unless linked to a skill.`
    );
  }
  if (prompt.length > 12_000) {
    throw new DashboardTemplateValidationError(`Row "${slug}": prompt is too long.`);
  }

  const optionalUrl = (value: unknown, label: string): string | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string" || !isAllowedMediaUrl(value)) {
      throw new DashboardTemplateValidationError(
        `Row "${slug}": ${label} must be an https:// link or site-relative path.`
      );
    }
    return value.trim();
  };

  const shotCountRaw = row.shotCount;
  let shotCount: number | undefined;
  if (shotCountRaw !== undefined && shotCountRaw !== null && shotCountRaw !== "") {
    const n = typeof shotCountRaw === "number" ? shotCountRaw : Number(shotCountRaw);
    if (!Number.isInteger(n) || n < 1 || n > 32) {
      throw new DashboardTemplateValidationError(
        `Row "${slug}": shot count must be an integer between 1 and 32.`
      );
    }
    shotCount = n;
  }

  return {
    slug,
    kind,
    title,
    videoUrl,
    ...(generationVideoUrl ? { generationVideoUrl } : {}),
    ...(prompt ? { prompt } : {}),
    characterThumbUrl: optionalUrl(row.characterThumbUrl, "character thumb URL"),
    referenceImageUrl: optionalUrl(row.referenceImageUrl, "reference image URL"),
    productThumbUrl: optionalUrl(row.productThumbUrl, "product thumb URL"),
    ...(skillId ? { skillId } : {}),
    ...(shotCount ? { shotCount } : {}),
    isActive: row.isActive !== false,
    sortOrder: index,
  };
}

export function dashboardTemplatesSelfCheck(): void {
  const valid = parseAdminDashboardTemplate(
    {
      slug: "demo-clip.webm",
      kind: "motion_control",
      title: "",
      videoUrl: "https://cdn.kelolako.com/trending-template-1/demo.webm",
      generationVideoUrl: "https://cdn.kelolako.com/trending-template-1/demo.mp4",
      isActive: true,
    },
    0,
    "motion_control"
  );
  if (valid.slug !== "demo-clip.webm") {
    throw new Error("dashboard-templates self-check: motion control parse failed");
  }

  const viral = parseAdminDashboardTemplate(
    {
      slug: "kelolako_viral_videos_00001.mp4",
      kind: "viral",
      title: "Helicopter golden hour",
      videoUrl: "https://cdn.kelolako.com/Viral%20Template/clip.webm",
      prompt: "Cinematic vertical shot.",
      characterThumbUrl: "/viral-templates/character-thumb.webp",
      isActive: true,
    },
    0,
    "viral"
  );
  const mapped = toTrendingTemplate(viral);
  if (mapped.id !== "kelolako_viral_videos_00001.mp4" || !mapped.prompt) {
    throw new Error("dashboard-templates self-check: viral parse/map failed");
  }

  let threw = false;
  try {
    parseAdminDashboardTemplate(
      { slug: "bad", kind: "viral", title: "x", videoUrl: "ftp://nope" },
      0,
      "viral"
    );
  } catch (e) {
    threw = e instanceof DashboardTemplateValidationError;
  }
  if (!threw) {
    throw new Error("dashboard-templates self-check: invalid URL must throw");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  dashboardTemplatesSelfCheck();
  console.log("dashboard-templates self-check passed");
}
