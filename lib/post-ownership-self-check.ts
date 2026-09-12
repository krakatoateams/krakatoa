import { postOwnerDenied } from "./post-ownership-pure";
import { unauthenticatedProviderHttp } from "./provider-route-auth-pure";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`post-ownership self-check: ${message}`);
}

export function postOwnershipSelfCheck(): void {
  const denied = postOwnerDenied("other-profile", "session-profile");
  assert(denied?.status === 403, "wrong-owner post mutation must be 403");
  assert(denied?.error === "Forbidden.", "wrong-owner post mutation must not leak the post");
  assert(
    postOwnerDenied("session-profile", "session-profile") === null,
    "owner post mutation must proceed",
  );

  const unauth = unauthenticatedProviderHttp();
  assert(unauth.status === 401, "welcome-offer claim without a session must be 401");
}

postOwnershipSelfCheck();
console.log("post-ownership self-check passed");
