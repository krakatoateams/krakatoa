"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GENERATION_CHANGED_EVENT } from "@/lib/active-generation-events";
import {
  clearPersistedIdempotentAttempt,
  readPersistedIdempotentAttempt,
  resolveIdempotentAttemptState,
  writePersistedIdempotentAttempt,
  type IdempotentAttemptState,
  type IdempotentSubmitStorage,
} from "@/lib/idempotent-submit-state";

function emitGenerationChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(GENERATION_CHANGED_EVENT));
}

function browserSessionStorage(): IdempotentSubmitStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Client-side double-submit / double-charge protection for generation forms.
 *
 * Pairs with the server's request-level idempotency (lib/generation-idempotency.ts).
 * The server dedupes by (profile_id, Idempotency-Key) and is race-safe — but ONLY
 * if the client sends the SAME key for what is logically the same attempt.
 * Minting a fresh UUID on every click (the old behavior) defeated this: a
 * double-click, or a manual retry after a network blip, produced two DIFFERENT
 * keys, so the server treated them as two independent requests and ran the
 * provider (and charged) twice — even though the UI only showed one generation.
 *
 * This hook closes both gaps:
 *   1. A synchronous in-flight lock (a ref, not React state) so a rapid second
 *      submit is dropped BEFORE it can fire a second fetch. State updates are
 *      async and cannot reliably guard a same-tick double-click.
 *   2. A STABLE idempotency key per logical attempt: reused across retries with
 *      identical inputs (so the server replays/blocks the duplicate instead of
 *      launching a second run) and rotated only when the inputs change or after a
 *      confirmed success. The scoped key and a compact signature fingerprint
 *      (never the raw prompt/input) live in sessionStorage so navigation/remount
 *      cannot mint a second chargeable key for the same request.
 */
export type IdempotentAttempt = {
  /** The Idempotency-Key header value to send for this attempt. */
  key: string;
  /**
   * Call exactly once when the request settles.
   *   succeeded=true  -> clears the key so the NEXT submit (even with identical
   *                      inputs) starts a fresh generation.
   *   succeeded=false -> keeps the key so an immediate identical retry dedupes
   *                      server-side (replay a finished run / block an in-flight
   *                      one / take over a failed one) instead of double-charging.
   */
  settle: (succeeded: boolean) => void;
};

export function useIdempotentSubmit(scope: string) {
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const attemptStateRef = useRef<IdempotentAttemptState | null>(null);
  // Reactive mirrors so the UI can render a Cancel button while an attempt is
  // in flight, and disable it once a cancel request has been sent.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Acquire an attempt for the given input `signature` (a stable string built
   * from the same fields the server hashes). Returns null when a submit is
   * already in flight — the caller MUST abort in that case.
   */
  const begin = useCallback((signature: string): IdempotentAttempt | null => {
    if (!mountedRef.current || inFlightRef.current) return null;
    inFlightRef.current = true;

    const storage = browserSessionStorage();
    const previous =
      attemptStateRef.current ?? readPersistedIdempotentAttempt(storage, scope);
    const attemptState = resolveIdempotentAttemptState(
      signature,
      previous,
      () => crypto.randomUUID(),
      () => crypto.randomUUID(),
    );
    attemptStateRef.current = attemptState;
    writePersistedIdempotentAttempt(storage, scope, attemptState);

    const key = attemptState.key;
    setActiveKey(key);
    setCancelling(false);
    emitGenerationChanged();
    let settled = false;
    const settle = (succeeded: boolean) => {
      if (settled) return;
      settled = true;
      inFlightRef.current = false;
      if (mountedRef.current) {
        setActiveKey(null);
        setCancelling(false);
      }
      emitGenerationChanged();
      if (succeeded) {
        clearPersistedIdempotentAttempt(storage, scope, attemptState);
        if (attemptStateRef.current?.leaseId === attemptState.leaseId) {
          attemptStateRef.current = null;
        }
      }
    };
    return { key, settle };
  }, [scope]);

  /**
   * Cancel the in-flight attempt. Sends the attempt's Idempotency-Key to the
   * cancel endpoint, which stops the underlying Replicate prediction(s). The
   * still-open generate request then settles on its own (with a refund), which
   * resets `activeKey`/`cancelling` via settle(). Returns true when the cancel
   * request was accepted. Safe to call when nothing is in flight (no-op).
   */
  const cancel = useCallback(async (): Promise<boolean> => {
    const key = attemptStateRef.current?.key;
    if (!key || !inFlightRef.current) return false;
    if (mountedRef.current) setCancelling(true);
    try {
      const res = await fetch("/api/generations/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: key }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data?.code === "CANCEL_NOT_ALLOWED") {
          if (mountedRef.current) setCancelling(false);
          return false;
        }
        // Let the user try again; the generate request is still running.
        if (mountedRef.current) setCancelling(false);
        return false;
      }
      // Keep `cancelling` true: the in-flight generate fetch will resolve shortly
      // and settle() will reset the state.
      return true;
    } catch {
      if (mountedRef.current) setCancelling(false);
      return false;
    }
  }, []);

  return { begin, cancel, activeKey, cancelling };
}
