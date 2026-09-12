import {
  CreationNotFoundError,
  classifyCreationMutationError,
} from "./creation-ownership-pure";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`creation-ownership self-check: ${message}`);
}

export function creationOwnershipSelfCheck(): void {
  const missing = classifyCreationMutationError(new CreationNotFoundError());
  assert(missing.status === 404, "wrong-owner or missing creation must be 404, not 500");
  assert(
    missing.error === "Creation not found.",
    "missing creation must not leak a database error",
  );

  const infra = classifyCreationMutationError(new Error("boom"));
  assert(infra.status === 500, "infra failures must stay 500");
}

creationOwnershipSelfCheck();
console.log("creation-ownership self-check passed");
