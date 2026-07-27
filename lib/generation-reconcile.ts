import { supabaseServer } from "@/lib/supabase-server";
import { LOCK_TTL_MS, finishGenerationRequestFailure } from "@/lib/generation-idempotency";
import { failJob } from "@/lib/jobs-db";
import { refundCredits } from "@/lib/credits-db";

/** Buffer beyond idempotency lock TTL before treating a run as abandoned. */
const RECONCILE_BUFFER_MS = 5 * 60 * 1000;

export type GenerationReconcileResult = {
  staleJobs: number;
  refundedJobs: number;
  staleRequests: number;
  errors: string[];
};

async function hasRefundForJob(jobId: string): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("credit_transactions")
    .select("id")
    .eq("job_id", jobId)
    .eq("type", "refund")
    .eq("status", "succeeded")
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data as { id: string }[] | null) ?? []).length > 0;
}

async function spendAmountForJob(jobId: string): Promise<number> {
  const { data, error } = await supabaseServer
    .from("credit_transactions")
    .select("amount")
    .eq("job_id", jobId)
    .eq("type", "spend")
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { amount?: number } | null;
  return typeof row?.amount === "number" ? row.amount : 0;
}

/** Backstop for Vercel kills / orphaned runs: refund stuck jobs and close stale idempotency rows. */
export async function runGenerationReconcile(): Promise<GenerationReconcileResult> {
  const cutoff = new Date(Date.now() - LOCK_TTL_MS - RECONCILE_BUFFER_MS).toISOString();
  const result: GenerationReconcileResult = {
    staleJobs: 0,
    refundedJobs: 0,
    staleRequests: 0,
    errors: [],
  };

  const { data: staleJobs, error: jobsError } = await supabaseServer
    .from("jobs")
    .select("id, profile_id, cost_credits")
    .eq("status", "running")
    .lt("updated_at", cutoff)
    .limit(50);

  if (jobsError) {
    result.errors.push(`jobs query: ${jobsError.message}`);
  } else {
    for (const row of (staleJobs as { id: string; profile_id: string; cost_credits?: number }[] | null) ?? []) {
      result.staleJobs += 1;
      try {
        const refunded = await hasRefundForJob(row.id);
        if (!refunded) {
          const amount = await spendAmountForJob(row.id);
          const refundAmount = amount > 0 ? amount : row.cost_credits ?? 0;
          if (refundAmount > 0) {
            await refundCredits({
              profileId: row.profile_id,
              amount: refundAmount,
              idempotencyKey: `refund:reconcile:${row.id}`,
              jobId: row.id,
              description: "Refund after stale generation (reconcile cron)",
              metadata: { reason: "stale_generation", reconciledAt: new Date().toISOString() },
            });
            result.refundedJobs += 1;
          }
        }
        await failJob(row.profile_id, row.id, {
          code: "STALE_GENERATION",
          message: "Generation timed out or was interrupted. Credits were refunded if charged.",
        });
      } catch (e) {
        result.errors.push(`job ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const { data: staleRequests, error: reqError } = await supabaseServer
    .from("generation_requests")
    .select("id, job_id")
    .eq("status", "started")
    .lt("locked_until", new Date().toISOString())
    .limit(50);

  if (reqError) {
    result.errors.push(`generation_requests query: ${reqError.message}`);
  } else {
    for (const row of (staleRequests as { id: string; job_id: string | null }[] | null) ?? []) {
      result.staleRequests += 1;
      try {
        await finishGenerationRequestFailure({
          id: row.id,
          jobId: row.job_id,
          errorJson: {
            code: "STALE_GENERATION",
            message: "Generation request expired without finishing.",
          },
        });
      } catch (e) {
        result.errors.push(`request ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return result;
}
