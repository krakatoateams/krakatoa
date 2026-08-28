import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { getJob } from "@/lib/jobs-db";
import { canDismissGeneration } from "@/lib/generation-workflows/control-policy-pure";
import { dismissGenerationJob } from "@/lib/generation-workflows/workflow-db";

export const maxDuration = 30;

/**
 * POST /api/generations/dismiss
 *
 * Soft-dismiss a recent failed/cancelled job from active-generation tiles.
 * Body: `{ jobId: string }`
 */
export async function POST(req: Request) {
  try {
    const profile = await requireCurrentProfile();
    const body = await req.json().catch(() => null);
    const jobId = body && typeof body.jobId === "string" ? body.jobId.trim() : "";
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    const job = await getJob(profile.id, jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    if (!canDismissGeneration({ jobStatus: job.status })) {
      return NextResponse.json(
        { error: "Job cannot be dismissed.", status: job.status },
        { status: 409 },
      );
    }
    if (job.dismissed_at) {
      return NextResponse.json({ status: "already_dismissed" });
    }

    const dismissed = await dismissGenerationJob(profile.id, jobId);
    if (!dismissed) {
      return NextResponse.json({ error: "Could not dismiss job." }, { status: 409 });
    }

    return NextResponse.json({ status: "dismissed" });
  } catch (error: unknown) {
    if (error instanceof Error && /not authenticated/i.test(error.message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    console.error("[generations/dismiss] Error:", error);
    return NextResponse.json({ error: "Failed to dismiss generation." }, { status: 500 });
  }
}
