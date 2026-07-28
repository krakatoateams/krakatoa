/** Thrown when a pipeline step fails after expensive checkpoints exist — route should mark recoverable, not refund. */
export class RecoverablePipelineError extends Error {
  readonly code = "PIPELINE_RECOVERABLE";
  readonly step: string;

  constructor(message: string, step: string) {
    super(message);
    this.name = "RecoverablePipelineError";
    this.step = step;
  }
}

export function isRecoverablePipelineError(error: unknown): boolean {
  return error instanceof RecoverablePipelineError;
}
