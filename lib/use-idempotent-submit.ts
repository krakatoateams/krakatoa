"use client";

import { useCallback, useRef } from "react";

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
 *      confirmed success.
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

export function useIdempotentSubmit() {
  const inFlightRef = useRef(false);
  const keyRef = useRef<string | null>(null);
  const signatureRef = useRef<string | null>(null);

  /**
   * Acquire an attempt for the given input `signature` (a stable string built
   * from the same fields the server hashes). Returns null when a submit is
   * already in flight — the caller MUST abort in that case.
   */
  const begin = useCallback((signature: string): IdempotentAttempt | null => {
    if (inFlightRef.current) return null;
    inFlightRef.current = true;

    // Mint a new key only when the inputs changed or the previous attempt
    // succeeded (which nulled the key). Otherwise reuse the pending key so a
    // retry of the SAME request is deduped by the server.
    if (!keyRef.current || signatureRef.current !== signature) {
      keyRef.current = crypto.randomUUID();
      signatureRef.current = signature;
    }

    const key = keyRef.current;
    let settled = false;
    const settle = (succeeded: boolean) => {
      if (settled) return;
      settled = true;
      inFlightRef.current = false;
      if (succeeded) {
        keyRef.current = null;
        signatureRef.current = null;
      }
    };
    return { key, settle };
  }, []);

  return { begin };
}
