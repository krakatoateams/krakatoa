/**
 * Owner-scoped creation mutation outcomes. Pure — no Supabase.
 */

export class CreationNotFoundError extends Error {
  readonly code = "CREATION_NOT_FOUND";
  constructor(message = "Creation not found.") {
    super(message);
    this.name = "CreationNotFoundError";
  }
}

export function classifyCreationMutationError(e: unknown): {
  status: number;
  error: string;
} {
  if (e instanceof CreationNotFoundError) {
    return { status: 404, error: e.message };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { status: 500, error: message };
}
