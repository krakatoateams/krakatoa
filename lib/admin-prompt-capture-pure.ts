/**
 * What admin monitoring may persist for prompt visibility.
 *
 * User text belongs on jobs.input; the assembled model prompt belongs on the
 * job_step that calls the provider. System instructions stay unstored.
 */

export type CapturedReelsScene = {
  scene_id: number;
  video_prompt: string;
  narration: string;
};

export function reelsSceneBreakdownStepOutput(
  scenes: Array<{
    scene_id?: unknown;
    video_prompt?: unknown;
    narration?: unknown;
    [extra: string]: unknown;
  }>,
): { scenes: CapturedReelsScene[] } {
  return {
    scenes: scenes.map((s, i) => ({
      scene_id: typeof s.scene_id === "number" ? s.scene_id : i + 1,
      video_prompt: typeof s.video_prompt === "string" ? s.video_prompt : "",
      narration: typeof s.narration === "string" ? s.narration : "",
    })),
  };
}

export function assembledModelStepInput(
  assembledPrompt: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...extra, prompt: assembledPrompt };
}

export function storyboardVideoJobPromptFields(input: {
  theme: string | null | undefined;
}): Record<string, unknown> {
  const theme = typeof input.theme === "string" ? input.theme.trim() : "";
  return theme ? { theme } : {};
}

export function monitoringPromptEmptyHint(): string {
  return "Not recorded — older jobs, or a route that builds its prompt at call time, have nothing persisted.";
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`admin-prompt-capture self-check: ${message}`);
}

export function adminPromptCaptureSelfCheck(): void {
  const scenes = [
    {
      scene_id: 1,
      video_prompt: "wide shot, photorealistic",
      narration: "then the door opened",
      system_instruction: "NEVER STORE",
    },
  ];
  const breakdown = reelsSceneBreakdownStepOutput(scenes);
  assert(Array.isArray(breakdown.scenes), "Reels scene_breakdown must persist scenes, not a count");
  const stored = breakdown.scenes as CapturedReelsScene[];
  assert(stored.length === 1 && stored[0].video_prompt === "wide shot, photorealistic", "scene video_prompt");
  assert(stored[0].narration === "then the door opened", "scene narration");
  assert(
    !("system_instruction" in stored[0]) && !("systemPrompt" in breakdown),
    "system instructions must not be persisted",
  );

  const step = assembledModelStepInput("assembled pose wrap", { duration: 8 });
  assert(step.prompt === "assembled pose wrap", "assembled prompt belongs on the model-calling step");
  assert(step.duration === 8, "step extras stay intact");

  const job = storyboardVideoJobPromptFields({
    theme: "night market",
  });
  assert(job.theme === "night market", "storyboard video job stores the theme");
  assert(
    job.prompt === undefined,
    "assembled Seedance prompt belongs on the video_generation step, not the job",
  );

  assert(
    /older jobs/i.test(monitoringPromptEmptyHint()) &&
      !/never persists/i.test(monitoringPromptEmptyHint()),
    "empty copy must not claim every route never persists a prompt",
  );
}

if (require.main === module) {
  adminPromptCaptureSelfCheck();
  console.log("admin-prompt-capture self-check passed");
}
