import {
  postOwnerDenied,
  postPatchLostPublishRace,
  postPatchUpdateApplies,
  schedulePostCreateDenied,
} from "./post-ownership-pure";
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

  const hostedHttpNoSession = schedulePostCreateDenied(false);
  assert(
    hostedHttpNoSession?.status === 401,
    "hosted http video_url without a session must be 401",
  );
  assert(
    hostedHttpNoSession?.error === "Not authenticated.",
    "unauthenticated schedule must not leak a different error",
  );
  assert(
    schedulePostCreateDenied(true) === null,
    "authenticated schedule without platform linkage must proceed",
  );

  const claimedAt = "2026-09-12T00:00:00.000Z";
  const duringClaim = Date.parse("2026-09-12T00:05:00.000Z");
  const afterStale = Date.parse("2026-09-12T00:11:00.000Z");
  assert(
    postPatchUpdateApplies(
      { status: "scheduled", publish_started_at: claimedAt },
      duringClaim,
    ) === false,
    "PATCH must not apply after a concurrent cron claim",
  );
  assert(
    postPatchUpdateApplies(
      { status: "published", publish_started_at: claimedAt },
      duringClaim,
    ) === false,
    "PATCH must not apply after cron marks the post published",
  );
  assert(
    postPatchUpdateApplies(
      { status: "scheduled", publish_started_at: claimedAt },
      afterStale,
    ) === true,
    "PATCH may apply once the publish claim is stale",
  );
  assert(
    postPatchUpdateApplies({ status: "failed", publish_started_at: null }, duringClaim) ===
      true,
    "PATCH may apply to an unclaimed failed post",
  );
  assert(
    postPatchLostPublishRace(null)?.status === 409,
    "lost PATCH vs cron race must be 409",
  );
  assert(
    postPatchLostPublishRace({ id: "post-1" }) === null,
    "successful PATCH update must proceed",
  );

  const unauth = unauthenticatedProviderHttp();
  assert(unauth.status === 401, "welcome-offer claim without a session must be 401");
}

postOwnershipSelfCheck();
console.log("post-ownership self-check passed");
