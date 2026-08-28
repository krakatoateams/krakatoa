import { NextResponse } from "next/server";
import { recordPrediction } from "@/lib/generation-cancel";
import { resolvePollTerminalDecision } from "@/lib/generation-workflows/polling-pure";
import {
  completeProviderSubmission,
  completeWorkflowProviderSuccess,
} from "@/lib/generation-workflows/submission-fence-db";
import {
  parseReplicateWebhookPayload,
  verifyReplicateWebhookRequest,
} from "@/lib/generation-workflows/replicate-webhook";
import {
  verifyWebhookCallbackToken,
  webhookCallbackSecret,
} from "@/lib/generation-workflows/webhook-token-pure";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type RouteParams = { params: { submissionId: string } };

export async function POST(req: Request, { params }: RouteParams) {
  const submissionId = params.submissionId?.trim();
  if (!submissionId) {
    return NextResponse.json({ error: "Missing submission id." }, { status: 400 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("t")?.trim() ?? "";
  let callbackSecret: string;
  try {
    callbackSecret = webhookCallbackSecret();
  } catch (error) {
    console.error("[replicate webhook] callback secret unavailable:", error);
    return NextResponse.json({ error: "Webhook is unavailable." }, { status: 503 });
  }
  if (!token || !verifyWebhookCallbackToken(submissionId, token, callbackSecret)) {
    return NextResponse.json({ error: "Invalid callback token." }, { status: 401 });
  }

  const rawBody = await req.text();
  try {
    const valid = await verifyReplicateWebhookRequest(req, rawBody);
    if (!valid) {
      return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[replicate webhook] signature verification failed:", message);
    return NextResponse.json({ error: "Webhook verification failed." }, { status: 401 });
  }

  const payload = parseReplicateWebhookPayload(rawBody);
  if (!payload) {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const snapshot = await getProviderSubmissionById(submissionId);
  if (!snapshot) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }
  if (snapshot.predictionId && snapshot.predictionId !== payload.id) {
    return NextResponse.json({ error: "Prediction does not match submission." }, { status: 409 });
  }

  const terminal = resolvePollTerminalDecision({
    status: payload.status,
    output: payload.output,
    error: payload.error,
  });

  if (!terminal.terminal) {
    await recordPrediction({
      generationRequestId: snapshot.generationRequestId,
      profileId: snapshot.profileId,
      predictionId: payload.id,
      jobId: snapshot.jobId,
      kind: "video_motion_control",
      status: payload.status,
    });
    return NextResponse.json({ status: "accepted" });
  }

  const terminalState = terminal.outcome === "success" ? "completed" : "failed";
  const errorJson =
    terminal.outcome === "success"
      ? null
      : {
          message: terminal.message,
          code: terminal.outcome === "cancelled" ? "GENERATION_CANCELLED" : undefined,
        };

  if (terminal.outcome === "success") {
    if (!snapshot.jobId) {
      return NextResponse.json({ error: "Submission job is no longer available." }, { status: 409 });
    }
    const commit = await completeWorkflowProviderSuccess({
      profileId: snapshot.profileId,
      jobId: snapshot.jobId,
      generationRequestId: snapshot.generationRequestId,
      submissionId,
      predictionId: payload.id,
    });
    if (!commit.committed) {
      console.error("[replicate webhook] provider success commit rejected:", commit.reason);
      return NextResponse.json({ error: "Provider success was not accepted." }, { status: 409 });
    }
  } else {
    const completed = await completeProviderSubmission({
      profileId: snapshot.profileId,
      submissionId,
      predictionId: payload.id,
      terminalState,
      errorJson,
    });
    if (!completed) {
      return NextResponse.json({ error: "Provider result was not accepted." }, { status: 409 });
    }
  }

  await recordPrediction({
    generationRequestId: snapshot.generationRequestId,
    profileId: snapshot.profileId,
    predictionId: payload.id,
    jobId: snapshot.jobId,
    kind: "video_motion_control",
    status: payload.status,
  });

  return NextResponse.json({ status: "completed" });
}

/**
 * Deliberately not profile-scoped, unlike getProviderSubmission(): a webhook carries no
 * session. The signed callback token verified above is what authorizes this submission id,
 * and the owning profile is read from the row rather than trusted from the request.
 */
async function getProviderSubmissionById(submissionId: string): Promise<{
  profileId: string;
  jobId: string | null;
  generationRequestId: string;
  predictionId: string | null;
} | null> {
  const { data, error } = await supabaseServer
    .from("generation_provider_submissions")
    .select("profile_id, job_id, generation_request_id, prediction_id")
    .eq("id", submissionId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as {
    profile_id: string;
    job_id: string | null;
    generation_request_id: string;
    prediction_id: string | null;
  };
  return {
    profileId: row.profile_id,
    jobId: row.job_id,
    generationRequestId: row.generation_request_id,
    predictionId: row.prediction_id,
  };
}
