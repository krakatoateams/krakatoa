import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { getJob } from "@/lib/jobs-db";
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  getExistingGenerationRequest,
} from "@/lib/generation-idempotency";
import { readGenerationCancelAllowed } from "@/lib/generation-commit";
import { supabaseServer } from "@/lib/supabase-server";
import {
  canStopGenerationNow,
  generationControlSnapshot,
} from "@/lib/generation-workflows/control-policy-pure";
import {
  activeGenerationStale,
  humanizePhase,
} from "@/lib/active-generations-pure";
import { getGenerationRequestForJob } from "@/lib/generation-workflows/workflow-db";
import type { ExecutionBackend } from "@/lib/generation-workflows/types";

export const dynamic = "force-dynamic";

function generationStatusPayload(params: {
  status: string;
  cancelAllowed: boolean;
  phase: string | null;
  jobId: string | null;
  executionBackend: ExecutionBackend;
  heartbeatAt: string | null;
  updatedAt: string | null;
  jobStatus: string | null;
  providerCommittedAt: string | null;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
}) {
  const controls = generationControlSnapshot({
    jobStatus: params.jobStatus ?? params.status,
    providerCommittedAt: params.providerCommittedAt,
    cancelAllowed: params.cancelAllowed,
  });
  const isStale =
    params.updatedAt && params.jobStatus
      ? activeGenerationStale({
          executionBackend: params.executionBackend,
          heartbeatAt: params.heartbeatAt,
          updatedAt: params.updatedAt,
          jobStatus: params.jobStatus,
        })
      : false;

  return {
    status: params.status,
    cancelAllowed: params.cancelAllowed,
    phase: params.phase,
    jobId: params.jobId,
    executionBackend: params.executionBackend,
    heartbeatAt: params.heartbeatAt,
    updatedAt: params.updatedAt,
    isStale,
    canStop: canStopGenerationNow({
      jobStatus: params.jobStatus ?? params.status,
      executionBackend: params.executionBackend,
      cancelAllowed: params.cancelAllowed,
      isStale,
    }),
    refundEligible: controls.refundEligible,
    canRetry: controls.canRetry,
    canDismiss: controls.canDismiss,
    result: params.result,
    error: params.error,
  };
}

export async function GET(req: Request) {
  try {
    const profile = await requireCurrentProfile();
    const profileId = profile.id;
    const url = new URL(req.url);
    const jobIdParam = url.searchParams.get("jobId")?.trim() ?? "";

    if (jobIdParam) {
      const job = await getJob(profileId, jobIdParam);
      if (!job) {
        return NextResponse.json({ error: "Job not found." }, { status: 404 });
      }

      const genReq = await getGenerationRequestForJob(profileId, jobIdParam);
      const cancelAllowed = genReq?.cancel_allowed !== false;

      let phase: string | null = null;
      const { data: step } = await supabaseServer
        .from("job_steps")
        .select("step_key, status")
        .eq("job_id", jobIdParam)
        .eq("profile_id", profileId)
        .eq("status", "running")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (step && typeof (step as { step_key?: string }).step_key === "string") {
        phase = humanizePhase((step as { step_key: string }).step_key);
      }

      return NextResponse.json(
        generationStatusPayload({
          status: job.status,
          cancelAllowed,
          phase,
          jobId: job.id,
          executionBackend: job.execution_backend === "workflow" ? "workflow" : "legacy",
          heartbeatAt: job.heartbeat_at ?? null,
          updatedAt: job.updated_at,
          jobStatus: job.status,
          providerCommittedAt: genReq?.provider_committed_at ?? null,
          result: genReq?.response_json ?? null,
          error: genReq?.error_json ?? job.error ?? null,
        }),
      );
    }

    const idemKey = readIdempotencyKey(req);
    if (!isValidIdempotencyKey(idemKey)) {
      return NextResponse.json(
        { error: "Idempotency-Key header or jobId query is required.", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 },
      );
    }

    const generationRequest = await getExistingGenerationRequest(profileId, idemKey);
    if (!generationRequest) {
      return NextResponse.json({ error: "Generation not found." }, { status: 404 });
    }

    const cancelAllowed = await readGenerationCancelAllowed(profileId, generationRequest.id);
    const providerCommittedAt =
      (generationRequest as { provider_committed_at?: string | null }).provider_committed_at ??
      null;

    let phase: string | null = null;
    let jobStatus: string | null = null;
    let executionBackend: ExecutionBackend = "legacy";
    let heartbeatAt: string | null = null;
    let updatedAt: string | null = null;

    if (generationRequest.job_id) {
      const job = await getJob(profileId, generationRequest.job_id);
      if (job) {
        jobStatus = job.status;
        executionBackend = job.execution_backend === "workflow" ? "workflow" : "legacy";
        heartbeatAt = job.heartbeat_at ?? null;
        updatedAt = job.updated_at;
      }

      const { data: step } = await supabaseServer
        .from("job_steps")
        .select("step_key, status")
        .eq("job_id", generationRequest.job_id)
        .eq("profile_id", profileId)
        .eq("status", "running")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (step && typeof (step as { step_key?: string }).step_key === "string") {
        phase = humanizePhase((step as { step_key: string }).step_key);
      }
    }

    return NextResponse.json(
      generationStatusPayload({
        status: generationRequest.status,
        cancelAllowed,
        phase,
        jobId: generationRequest.job_id ?? null,
        executionBackend,
        heartbeatAt,
        updatedAt,
        jobStatus: jobStatus ?? generationRequest.status,
        providerCommittedAt,
        result: generationRequest.response_json ?? null,
        error: generationRequest.error_json ?? null,
      }),
    );
  } catch (error: unknown) {
    if (error instanceof Error && /not authenticated/i.test(error.message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    console.error("[generations/status] Error:", error);
    return NextResponse.json({ error: "Failed to read generation status." }, { status: 500 });
  }
}
