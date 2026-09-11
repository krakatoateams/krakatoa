export type IdempotentAttemptState = {
  key: string;
  signatureFingerprint: string;
  leaseId: string;
};

export type IdempotentSubmitStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

type PersistedIdempotentAttempt = IdempotentAttemptState & {
  version: 1;
};

const STORAGE_PREFIX = "krakatoa:generation-attempt:";

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${scope}`;
}

function signatureFingerprint(signature: string): string {
  let hash = 2166136261;
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${signature.length}:${(hash >>> 0).toString(36)}`;
}

export function resolveIdempotentAttemptState(
  signature: string,
  previous: IdempotentAttemptState | null,
  createKey: () => string,
  createLease: () => string,
): IdempotentAttemptState {
  const fingerprint = signatureFingerprint(signature);
  const key = previous?.signatureFingerprint === fingerprint ? previous.key : createKey();
  return { key, signatureFingerprint: fingerprint, leaseId: createLease() };
}

export function readPersistedIdempotentAttempt(
  storage: IdempotentSubmitStorage | null,
  scope: string,
): IdempotentAttemptState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedIdempotentAttempt>;
    if (
      parsed.version !== 1 ||
      typeof parsed.key !== "string" ||
      !parsed.key ||
      typeof parsed.signatureFingerprint !== "string" ||
      !parsed.signatureFingerprint ||
      typeof parsed.leaseId !== "string" ||
      !parsed.leaseId
    ) {
      return null;
    }
    return {
      key: parsed.key,
      signatureFingerprint: parsed.signatureFingerprint,
      leaseId: parsed.leaseId,
    };
  } catch {
    return null;
  }
}

export function writePersistedIdempotentAttempt(
  storage: IdempotentSubmitStorage | null,
  scope: string,
  state: IdempotentAttemptState,
): void {
  if (!storage) return;
  try {
    const persisted: PersistedIdempotentAttempt = { version: 1, ...state };
    storage.setItem(storageKey(scope), JSON.stringify(persisted));
  } catch {
    // Browser storage is best-effort; server idempotency remains authoritative.
  }
}

export function clearPersistedIdempotentAttempt(
  storage: IdempotentSubmitStorage | null,
  scope: string,
  settledAttempt: IdempotentAttemptState,
): void {
  if (!storage) return;
  const persisted = readPersistedIdempotentAttempt(storage, scope);
  if (
    persisted?.key !== settledAttempt.key ||
    persisted.leaseId !== settledAttempt.leaseId
  ) {
    return;
  }
  try {
    storage.removeItem(storageKey(scope));
  } catch {
    // Browser storage is best-effort; a stale key only causes a safe replay/conflict.
  }
}
