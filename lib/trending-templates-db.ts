import { supabaseServer } from "@/lib/supabase-server";

/**
 * Trending Templates data access (service-role).
 *
 * Global, admin-curated showcase videos rendered in the dashboard carousel.
 * Read-only from the app; rows are managed directly in the DB (see
 * supabase/migrations/046_trending_templates.sql).
 */

export type TrendingTemplate = {
  id: string;
  title: string | null;
  video_url: string;
  thumbnail_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const TRENDING_TEMPLATES_TABLE = "trending_templates";

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (
    error.message.includes("trending_templates") &&
    (error.message.includes("schema cache") ||
      error.message.includes("does not exist"))
  ) {
    throw new Error(
      "Database table trending_templates is missing. Run: npm run db:setup — or apply supabase/migrations/046_trending_templates.sql."
    );
  }
  throw new Error(error.message || fallback);
}

/** List active trending templates ordered by sort_order (ascending). */
export async function listActiveTrendingTemplates(): Promise<TrendingTemplate[]> {
  const { data, error } = await supabaseServer
    .from(TRENDING_TEMPLATES_TABLE)
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  handleError(error, "Failed to list trending templates.");
  return (data as TrendingTemplate[] | null) ?? [];
}
