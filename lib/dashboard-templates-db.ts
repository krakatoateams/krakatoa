import { supabaseServer } from "@/lib/supabase-server";
import {
  type AdminDashboardTemplate,
  type DashboardTemplateKind,
  toTrendingTemplate,
} from "@/lib/dashboard-templates-pure";
import {
  DEFAULT_VIRAL_TEMPLATE_REFERENCE_FRAME,
  defaultMotionControlTemplates,
  defaultViralTemplates,
  type TrendingTemplate,
} from "@/lib/trending-templates";

const TABLE = "trending_templates";
const CACHE_TTL_MS = 30_000;

type TemplateRow = {
  id: string;
  slug: string | null;
  kind: DashboardTemplateKind;
  title: string | null;
  video_url: string;
  generation_video_url: string | null;
  prompt: string | null;
  character_thumb_url: string | null;
  reference_image_url: string | null;
  product_thumb_url: string | null;
  skill_id: string | null;
  shot_count: number | null;
  duration_sec: number | null;
  is_active: boolean;
  sort_order: number;
};

type TemplateCache = {
  viral: TrendingTemplate[];
  motionControl: TrendingTemplate[];
  expiresAt: number;
};

let cache: TemplateCache = {
  viral: [],
  motionControl: [],
  expiresAt: 0,
};

const SELECT =
  "id, slug, kind, title, video_url, generation_video_url, prompt, character_thumb_url, reference_image_url, product_thumb_url, skill_id, shot_count, duration_sec, is_active, sort_order";

function fromTrendingTemplate(
  template: TrendingTemplate,
  kind: DashboardTemplateKind,
  sortOrder: number
): AdminDashboardTemplate {
  return {
    slug: template.id,
    kind,
    title: template.title ?? "",
    videoUrl: template.videoUrl ?? "",
    ...(template.generationVideoUrl ? { generationVideoUrl: template.generationVideoUrl } : {}),
    ...(template.prompt ? { prompt: template.prompt } : {}),
    ...(template.characterImageUrl ? { characterThumbUrl: template.characterImageUrl } : {}),
    ...(template.referenceImageUrl ? { referenceImageUrl: template.referenceImageUrl } : {}),
    ...(template.productImageUrl ? { productThumbUrl: template.productImageUrl } : {}),
    ...(template.skillId ? { skillId: template.skillId } : {}),
    ...(template.shotCount ? { shotCount: template.shotCount } : {}),
    ...(template.durationSec ? { durationSec: template.durationSec } : {}),
    isActive: true,
    sortOrder,
  };
}

function defaultAdminTemplates(kind: DashboardTemplateKind): AdminDashboardTemplate[] {
  const source =
    kind === "viral" ? defaultViralTemplates() : defaultMotionControlTemplates();
  return source.map((template, index) => fromTrendingTemplate(template, kind, index));
}

function rowToAdmin(row: TemplateRow): AdminDashboardTemplate {
  const slug = row.slug?.trim() || row.id;
  return {
    slug,
    kind: row.kind,
    title: row.title?.trim() ?? "",
    videoUrl: row.video_url,
    ...(row.generation_video_url ? { generationVideoUrl: row.generation_video_url } : {}),
    ...(row.prompt ? { prompt: row.prompt } : {}),
    ...(row.character_thumb_url ? { characterThumbUrl: row.character_thumb_url } : {}),
    ...(row.reference_image_url ? { referenceImageUrl: row.reference_image_url } : {}),
    ...(row.product_thumb_url ? { productThumbUrl: row.product_thumb_url } : {}),
    ...(row.skill_id ? { skillId: row.skill_id } : {}),
    ...(row.shot_count ? { shotCount: row.shot_count } : {}),
    ...(row.duration_sec ? { durationSec: row.duration_sec } : {}),
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

function bustCache(): void {
  cache = { viral: [], motionControl: [], expiresAt: 0 };
}

function videoUrlMatchesTemplate(videoUrl: string, template: AdminDashboardTemplate): boolean {
  const normalized = videoUrl.trim();
  if (!normalized) return false;
  if (normalized === template.videoUrl) return true;
  if (template.generationVideoUrl && normalized === template.generationVideoUrl) return true;
  try {
    const pathname = decodeURIComponent(new URL(normalized).pathname);
    return pathname.endsWith(`/${template.slug}`) || pathname.endsWith(template.slug);
  } catch {
    return normalized.includes(template.slug);
  }
}

function templateRowMatchesDefault(row: TemplateRow, template: AdminDashboardTemplate): boolean {
  const slug = row.slug?.trim();
  if (slug && slug === template.slug) return true;
  return videoUrlMatchesTemplate(row.video_url, template);
}

function slugFromVideoUrl(videoUrl: string, fallback: string): string {
  try {
    const pathname = decodeURIComponent(new URL(videoUrl.trim()).pathname);
    const file = pathname.split("/").filter(Boolean).pop();
    if (file) return file;
  } catch {
    const file = videoUrl.split("/").filter(Boolean).pop();
    if (file) return file;
  }
  return fallback;
}

async function backfillMissingSlugs(rows: TemplateRow[]): Promise<void> {
  for (const row of rows) {
    if (row.slug?.trim()) continue;
    const slug = slugFromVideoUrl(row.video_url, row.id);
    const { error } = await supabaseServer.from(TABLE).update({ slug }).eq("id", row.id);
    if (error) throw new Error(error.message);
    row.slug = slug;
  }
}

function mapTemplateInsertRow(
  template: AdminDashboardTemplate,
  sortOrder: number
): Record<string, unknown> {
  return {
    slug: template.slug,
    kind: template.kind,
    title: template.title || null,
    video_url: template.videoUrl,
    generation_video_url: template.generationVideoUrl ?? null,
    prompt: template.prompt ?? null,
    character_thumb_url: template.characterThumbUrl ?? null,
    reference_image_url: template.referenceImageUrl ?? null,
    product_thumb_url: template.productThumbUrl ?? null,
    skill_id: template.skillId ?? null,
    shot_count: template.shotCount ?? null,
    duration_sec: template.durationSec ?? null,
    is_active: template.isActive,
    sort_order: sortOrder,
  };
}

async function syncDefaultTemplates(kind: DashboardTemplateKind): Promise<void> {
  const existing = await readRows(kind, { includeInactive: true });
  if (existing.length === 0) {
    const defaults = defaultAdminTemplates(kind);
    const rows = defaults.map((template) => mapTemplateInsertRow(template, template.sortOrder));
    const { error } = await supabaseServer.from(TABLE).insert(rows);
    if (error) throw new Error(error.message);
    return;
  }

  await backfillMissingSlugs(existing);

  const defaults = defaultAdminTemplates(kind);
  const missing = defaults.filter(
    (template) => !existing.some((row) => templateRowMatchesDefault(row, template))
  );
  if (missing.length === 0) return;

  const nextSortOrder =
    existing.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;
  const rows = missing.map((template, index) =>
    mapTemplateInsertRow(template, nextSortOrder + index)
  );
  const { error } = await supabaseServer.from(TABLE).insert(rows);
  if (error) throw new Error(error.message);
  bustCache();
}

async function readRows(
  kind: DashboardTemplateKind,
  options?: { includeInactive?: boolean }
): Promise<TemplateRow[]> {
  let query = supabaseServer
    .from(TABLE)
    .select(SELECT)
    .eq("kind", kind)
    .order("sort_order", { ascending: true });

  if (!options?.includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as TemplateRow[];
}

export async function listAdminDashboardTemplates(
  kind: DashboardTemplateKind
): Promise<AdminDashboardTemplate[]> {
  await syncDefaultTemplates(kind);
  const rows = await readRows(kind, { includeInactive: true });
  return rows.map(rowToAdmin);
}

function rowToTrendingTemplate(row: TemplateRow, kind: DashboardTemplateKind): TrendingTemplate {
  const template = toTrendingTemplate(rowToAdmin(row));
  if (kind === "viral" && !template.referenceImageUrl) {
    return { ...template, referenceImageUrl: DEFAULT_VIRAL_TEMPLATE_REFERENCE_FRAME };
  }
  return template;
}

export async function listPublicDashboardTemplates(
  kind: DashboardTemplateKind
): Promise<TrendingTemplate[]> {
  try {
    await syncDefaultTemplates(kind);
    const rows = await readRows(kind);
    return rows.map((row) => rowToTrendingTemplate(row, kind));
  } catch (e) {
    console.warn(`[dashboard-templates] read ${kind} failed, using code defaults:`, e);
    return kind === "viral" ? defaultViralTemplates() : defaultMotionControlTemplates();
  }
}

export async function getPublicDashboardTemplateCatalog(): Promise<{
  viral: TrendingTemplate[];
  motionControl: TrendingTemplate[];
}> {
  const now = Date.now();
  if (cache.expiresAt > now && cache.viral.length + cache.motionControl.length > 0) {
    return { viral: cache.viral, motionControl: cache.motionControl };
  }

  const [viral, motionControl] = await Promise.all([
    listPublicDashboardTemplates("viral"),
    listPublicDashboardTemplates("motion_control"),
  ]);

  cache = { viral, motionControl, expiresAt: now + CACHE_TTL_MS };
  return { viral, motionControl };
}

export async function saveAllDashboardTemplates(
  kind: DashboardTemplateKind,
  templates: AdminDashboardTemplate[]
): Promise<AdminDashboardTemplate[]> {
  const { data: existingRows, error: readError } = await supabaseServer
    .from(TABLE)
    .select("id, slug")
    .eq("kind", kind);
  if (readError) throw new Error(readError.message);

  const existingBySlug = new Map(
    (existingRows ?? [])
      .filter((row) => typeof row.slug === "string" && row.slug.trim())
      .map((row) => [row.slug as string, row.id as string])
  );

  const keepIds = new Set<string>();
  for (const template of templates) {
    const row = {
      slug: template.slug,
      kind: template.kind,
      title: template.title || null,
      video_url: template.videoUrl,
      generation_video_url: template.generationVideoUrl ?? null,
      prompt: template.prompt ?? null,
      character_thumb_url: template.characterThumbUrl ?? null,
      reference_image_url: template.referenceImageUrl ?? null,
      product_thumb_url: template.productThumbUrl ?? null,
      skill_id: template.skillId ?? null,
      shot_count: template.shotCount ?? null,
      duration_sec: template.durationSec ?? null,
      is_active: template.isActive,
      sort_order: template.sortOrder,
    };

    const existingId = existingBySlug.get(template.slug);
    if (existingId) {
      const { error } = await supabaseServer.from(TABLE).update(row).eq("id", existingId);
      if (error) throw new Error(error.message);
      keepIds.add(existingId);
      continue;
    }

    const { data, error } = await supabaseServer.from(TABLE).insert(row).select("id").single();
    if (error) throw new Error(error.message);
    keepIds.add(data.id as string);
  }

  const deleteIds = (existingRows ?? [])
    .map((row) => row.id as string)
    .filter((id) => !keepIds.has(id));

  if (deleteIds.length > 0) {
    const { error } = await supabaseServer.from(TABLE).delete().in("id", deleteIds);
    if (error) throw new Error(error.message);
  }

  bustCache();
  return listAdminDashboardTemplates(kind);
}

export async function findViralTemplateBySlug(slug: string): Promise<TrendingTemplate | null> {
  const catalog = await getPublicDashboardTemplateCatalog();
  const fromDb = catalog.viral.find((template) => template.id === slug);
  if (fromDb) return fromDb;
  return defaultViralTemplates().find((template) => template.id === slug) ?? null;
}

export async function isComposerViralTemplateSlug(slug: string): Promise<boolean> {
  const template = await findViralTemplateBySlug(slug);
  return Boolean(template && !template.skillId);
}

export async function findMotionControlGenerationUrl(
  previewUrl: string
): Promise<string> {
  const normalized = previewUrl.trim();
  const catalog = await getPublicDashboardTemplateCatalog();
  const match = catalog.motionControl.find((template) => template.videoUrl === normalized);
  if (match?.generationVideoUrl) return match.generationVideoUrl;
  if (/\.webm$/i.test(normalized)) {
    return normalized.replace(/\.webm$/i, "_compressed.mp4");
  }
  return normalized;
}
