import {
  clearPersistedIdempotentAttempt,
  readPersistedIdempotentAttempt,
  resolveIdempotentAttemptState,
  writePersistedIdempotentAttempt,
  type IdempotentSubmitStorage,
} from "./idempotent-submit-state";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`idempotent-submit-state self-check: ${message}`);
}

function memoryStorage(): IdempotentSubmitStorage {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

export function idempotentSubmitStateSelfCheck(): void {
  const storage = memoryStorage();
  let lease = 0;
  const nextLease = () => `lease-${++lease}`;
  const first = resolveIdempotentAttemptState("same request", null, () => "key-1", nextLease);
  writePersistedIdempotentAttempt(storage, "video:t2v", first);

  const restored = readPersistedIdempotentAttempt(storage, "video:t2v");
  const remounted = resolveIdempotentAttemptState(
    "same request",
    restored,
    () => "key-2",
    nextLease,
  );
  assert(remounted.key === "key-1", "same request reuses key after remount");
  assert(remounted.leaseId !== first.leaseId, "remount claims a fresh settlement lease");

  writePersistedIdempotentAttempt(storage, "video:t2v", remounted);
  clearPersistedIdempotentAttempt(storage, "video:t2v", first);
  assert(
    readPersistedIdempotentAttempt(storage, "video:t2v")?.leaseId === remounted.leaseId,
    "stale completion cannot clear a remounted request with the same key",
  );

  const changed = resolveIdempotentAttemptState(
    "changed request",
    restored,
    () => "key-2",
    nextLease,
  );
  assert(changed.key === "key-2", "changed request rotates key");

  writePersistedIdempotentAttempt(storage, "video:t2v", changed);
  clearPersistedIdempotentAttempt(storage, "video:t2v", remounted);
  assert(
    readPersistedIdempotentAttempt(storage, "video:t2v")?.key === "key-2",
    "stale completion cannot clear newer request",
  );

  clearPersistedIdempotentAttempt(storage, "video:t2v", changed);
  assert(
    readPersistedIdempotentAttempt(storage, "video:t2v") === null,
    "terminal success clears matching key",
  );

  // Server 409 (key bound to a different request): rotate clears the record, so the
  // next click mints a fresh key; a plain failure (settle(false)) keeps it.
  const conflictScope = "canvas:image:n1";
  const lease2 = () => "lease-x";
  const stuck = resolveIdempotentAttemptState("S", null, () => "stale-key", lease2);
  writePersistedIdempotentAttempt(storage, conflictScope, stuck);
  const plainRetry = resolveIdempotentAttemptState(
    "S",
    readPersistedIdempotentAttempt(storage, conflictScope),
    () => "fresh-key",
    lease2,
  );
  assert(plainRetry.key === "stale-key", "retry after settle(false) reuses the key");
  clearPersistedIdempotentAttempt(storage, conflictScope, plainRetry); // settle(false, { rotate: true })
  assert(readPersistedIdempotentAttempt(storage, conflictScope) === null, "conflict clears record");
  const second = resolveIdempotentAttemptState(
    "S",
    readPersistedIdempotentAttempt(storage, conflictScope),
    () => "fresh-key",
    lease2,
  );
  assert(second.key === "fresh-key", "click after conflict sends a different key");
  writePersistedIdempotentAttempt(storage, conflictScope, second);
  const third = resolveIdempotentAttemptState(
    "S",
    readPersistedIdempotentAttempt(storage, conflictScope),
    () => "another-key",
    lease2,
  );
  assert(third.key === "fresh-key", "third identical click reuses the second key");

  storage.setItem("krakatoa:generation-attempt:invalid", "{oops");
  assert(
    readPersistedIdempotentAttempt(storage, "invalid") === null,
    "invalid persisted data fails closed",
  );
}

if (process.argv[1]?.includes("idempotent-submit-state-self-check")) {
  idempotentSubmitStateSelfCheck();
  console.log("idempotent-submit-state self-check ok");
}
