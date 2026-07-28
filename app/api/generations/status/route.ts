import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  getExistingGenerationRequest,
} from "@/lib/generation-idempotency";
import { readGenerationCancelAllowed } from "@/lib/generation-commit";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const profile = await requireCurrentProfile();
    const profileId = profile.id;

    const idemKey = readIdempotencyKey(req);
    if (!isValidIdempotencyKey(idemKey)) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required.", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 },
      );
    }

    const generationRequest = await getExistingGenerationRequest(profileId, idemKey);
    if (!generationRequest) {
      return NextResponse.json({ error: "Generation not found." }, { status: 404 });
    }

    const cancelAllowed = await readGenerationCancelAllowed(profileId, generationRequest.id);

    let phase: string | null = null;
    if (generationRequest.job_id) {
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
        phase = (step as { step_key: string }).step_key;
      }
    }

    return NextResponse.json({
      status: generationRequest.status,
      cancelAllowed,
      phase,
      jobId: generationRequest.job_id ?? null,
    });
  } catch (error: unknown) {
    if (error instanceof Error && /not authenticated/i.test(error.message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[generations/status] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
