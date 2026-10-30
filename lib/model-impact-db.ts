import { supabaseServer } from "@/lib/supabase-server";
import { providerSlugsFor, type ModelImpactReads } from "@/lib/model-impact";
import { listModelConfigs } from "@/lib/model-configs-db";

/** Production reads for the impact preview: head-only exact counts, no rows, no user data. */
export const dbModelImpactReads: ModelImpactReads = {
  async count(slugs, scope) {
    if (slugs.length === 0) return 0;
    let q = supabaseServer.from(scope.table).select("id", { count: "exact", head: true }).in("model", slugs);
    if (scope.sinceIso) q = q.gte("created_at", scope.sinceIso);
    if (scope.inFlight) q = q.in("status", ["queued", "running", "recoverable"]);
    if (scope.table === "assets") q = q.is("deleted_at", null);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  },
  async skillsDesignating(modelId) {
    const { data, error } = await supabaseServer.from("skill_configs").select("skill_id").eq("model_id", modelId).limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: { skill_id: string }) => r.skill_id);
  },
};

/** In-flight jobs for the archive warning; null when unknown. */
export async function inFlightJobsFor(toolKey: "photo" | "reels", modelId: string): Promise<number | null> {
  try {
    return await dbModelImpactReads.count(providerSlugsFor(toolKey, modelId, await listModelConfigs()), {
      table: "jobs",
      inFlight: true,
    });
  } catch {
    return null;
  }
}
