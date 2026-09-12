import {
  requireResolvedSessionUserId,
  unauthenticatedProviderHttp,
} from "./provider-route-auth-pure";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`provider-route-auth self-check: ${message}`);
}

export function providerRouteAuthSelfCheck(): void {
  const denied = unauthenticatedProviderHttp();
  assert(denied.status === 401, "unauthenticated provider routes must return 401");
  assert(
    denied.error === "Not authenticated.",
    "unauthenticated provider routes must not leak a different error",
  );
  assert(
    requireResolvedSessionUserId("user-1") === "user-1",
    "a resolved session must proceed",
  );
  try {
    requireResolvedSessionUserId(null);
    throw new Error("provider-route-auth self-check: missing session must throw");
  } catch (e) {
    assert(
      e instanceof Error && e.message === denied.error,
      "a missing session must throw the same unauthenticated error",
    );
  }
}

providerRouteAuthSelfCheck();
console.log("provider-route-auth self-check passed");
