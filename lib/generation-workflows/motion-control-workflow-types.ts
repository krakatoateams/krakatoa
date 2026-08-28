import type { MotionControlMode, CharacterOrientation } from "@/lib/motion-control-models";
import { SUBMISSION_PENDING_TIMEOUT_MS } from "./submission-fence-pure";

/** Serializable workflow input — keep in sync with motion-control route stamping. */
export type MotionControlWorkflowParams = {
  profileId: string;
  userId: string;
  jobId: string;
  generationRequestId: string;
  videoAssetId: string | null;
  creditsAmount: number;
  modelRef: string;
  providerInput: Record<string, unknown>;
  modelId: string;
  mode: MotionControlMode;
  characterOrientation: CharacterOrientation;
  keepOriginalSound: boolean;
  billedDuration: number;
  pricingKey: string;
  prompt: string;
  provider: string;
  providerModel: string;
  tempRefPaths: string[];
  stepLabel: string;
};

export const MOTION_CONTROL_SUBMISSION_SLOT = "motion_control:primary";

export const MOTION_CONTROL_POLL_SLEEP_MS = 12_000;
export const MOTION_CONTROL_MAX_POLL_ITERATIONS = 150;

/**
 * Worst case a durable run can take: a full ambiguous-submit fence wait followed by the
 * entire provider poll ceiling. The composer derives its own timeout from this, so it
 * never declares failure while the run is still alive.
 */
export const MOTION_CONTROL_MAX_RUNTIME_MS =
  SUBMISSION_PENDING_TIMEOUT_MS +
  MOTION_CONTROL_POLL_SLEEP_MS * MOTION_CONTROL_MAX_POLL_ITERATIONS;

const WORKFLOW_STOPPED_MARKER = "WORKFLOW_STOPPED:";

export function workflowStoppedMessage(): string {
  return `${WORKFLOW_STOPPED_MARKER} Generation stopped by user.`;
}

export function isWorkflowStoppedError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(WORKFLOW_STOPPED_MARKER);
}

/** Deterministic deliverable path — safe to upsert on workflow replay. */
export function motionControlWorkflowStoragePath(userId: string, jobId: string): string {
  const safeUser = userId.replace(/[^a-zA-Z0-9-]/g, "");
  const safeJob = jobId.replace(/[^a-zA-Z0-9-]/g, "");
  return `${safeUser}/videos/generated/video/motion-control/${safeJob}.mp4`;
}
