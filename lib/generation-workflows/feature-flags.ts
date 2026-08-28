import type { ExecutionBackend } from "./types";
import {
  isMeteredJobType,
  METERED_JOB_TYPES,
  type MeteredJobType,
} from "./metered-job-types";

/**
 * Comma-separated allowlist, e.g. `video_motion_control,reels_seedance`.
 * Empty / unset → every metered job type stays on legacy (disabled by default).
 */
const ENABLED_ENV = "GENERATION_WORKFLOW_ENABLED_JOB_TYPES";

function enabledJobTypeAllowlist(): ReadonlySet<string> {
  const raw = process.env[ENABLED_ENV]?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Per-job-type workflow flag. Defaults off for every metered job type. */
export function isWorkflowEnabledForJobType(jobType: string): boolean {
  if (!isMeteredJobType(jobType)) return false;
  return enabledJobTypeAllowlist().has(jobType);
}

/** Execution backend to stamp on create when a route adopts workflow (Phase 3+). */
export function resolveExecutionBackendForJobType(jobType: string): ExecutionBackend {
  return isWorkflowEnabledForJobType(jobType) ? "workflow" : "legacy";
}

/** Introspection for admin/canary — does not mutate state. */
export function workflowFlagSnapshot(): Record<MeteredJobType, boolean> {
  const enabled = enabledJobTypeAllowlist();
  const out = {} as Record<MeteredJobType, boolean>;
  for (const jobType of METERED_JOB_TYPES) {
    out[jobType] = enabled.has(jobType);
  }
  return out;
}
