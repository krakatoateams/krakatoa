import { supabaseServer } from "@/lib/supabase-server";
import { closeRecoverableJobTerminal, userIdFromJob } from "./failure";
import { parseRecoveryManifest } from "./manifest";
import { purgeResumableJobStorage } from "./storage";
import { finishGenerationRequestsForJob } from "@/lib/generation-idempotency";

export type ResumableReconcileResult = {
  expiredRecoverable: number;
  sweptFolders: number;
  errors: string[];
};

/** Expire recoverable jobs past TTL and sweep orphan resumable folders. */
export async function runResumableStorageReconcile(): Promise<ResumableReconcileResult> {
  const result: ResumableReconcileResult = {
    expiredRecoverable: 0,
    sweptFolders: 0,
    errors: [],
  };

  const now = new Date().toISOString();
  const { data: expired, error } = await supabaseServer
    .from("jobs")
    .select("id, profile_id, job_type, cost_credits, output, input")
    .eq("status", "recoverable")
    .limit(50);

  if (error) {
    result.errors.push(`recoverable query: ${error.message}`);
  } else {
    for (const row of (expired as {
      id: string;
      profile_id: string;
      job_type: string;
      cost_credits: number;
      output: Record<string, unknown>;
      input: Record<string, unknown>;
    }[] | null) ?? []) {
      const manifest = parseRecoveryManifest(row.output);
      if (!manifest || manifest.expiresAt > now) continue;
      result.expiredRecoverable += 1;
      const userId = userIdFromJob({
        id: row.id,
        profile_id: row.profile_id,
        project_id: null,
        tool: "",
        job_type: row.job_type,
        status: "recoverable",
        input: row.input,
        output: row.output,
        error: null,
        cost_credits: row.cost_credits,
        provider: null,
        model: null,
        started_at: null,
        finished_at: null,
        created_at: "",
        updated_at: "",
      });
      if (!userId) {
        result.errors.push(`job ${row.id}: missing userId for purge`);
        continue;
      }
      const resumeAttempts = manifest.resumeAttempts ?? 0;
      const refunded = resumeAttempts >= 1;
      try {
        await closeRecoverableJobTerminal({
          profileId: row.profile_id,
          userId,
          jobId: row.id,
          jobType: row.job_type,
          creditsAmount: row.cost_credits,
          reason: "ttl_expired",
          resumeAttempts,
          code: "RECOVERY_TTL_EXPIRED",
          message: refunded
            ? "Recovery window expired after retry attempts. Credits refunded."
            : "Recovery window expired without a retry. Credits were not refunded.",
        });
        await finishGenerationRequestsForJob({
          profileId: row.profile_id,
          jobId: row.id,
          errorJson: {
            code: "RECOVERY_TTL_EXPIRED",
            message: refunded
              ? "Recovery window expired after retry attempts. Credits refunded."
              : "Recovery window expired without a retry. Credits were not refunded.",
          },
        });
      } catch (e) {
        result.errors.push(
          `expire ${row.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  // Safety net: terminal jobs with leftover resumable folders.
  const { data: terminalWithRecovery, error: termErr } = await supabaseServer
    .from("jobs")
    .select("id, profile_id, status, output, input")
    .in("status", ["succeeded", "failed", "cancelled"])
    .not("output", "is", null)
    .limit(100);

  if (termErr) {
    result.errors.push(`terminal sweep query: ${termErr.message}`);
  } else {
    for (const row of (terminalWithRecovery as {
      id: string;
      profile_id: string;
      status: string;
      output: Record<string, unknown>;
      input: Record<string, unknown>;
    }[] | null) ?? []) {
      if (!parseRecoveryManifest(row.output)) continue;
      const userId = userIdFromJob({
        id: row.id,
        profile_id: row.profile_id,
        project_id: null,
        tool: "",
        job_type: "",
        status: row.status as "failed",
        input: row.input,
        output: row.output,
        error: null,
        cost_credits: 0,
        provider: null,
        model: null,
        started_at: null,
        finished_at: null,
        created_at: "",
        updated_at: "",
      });
      if (!userId) continue;
      const n = await purgeResumableJobStorage(userId, row.id);
      if (n > 0) result.sweptFolders += 1;
    }
  }

  return result;
}
