import {
  pathPrefixOwnedByUser,
  storedValueReferencesPath,
} from "./storage-sign-ownership-pure";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`storage-sign-ownership self-check: ${message}`);
}

export function storageSignOwnershipSelfCheck(): void {
  const userId = "user-owner-1";
  const owned = `${userId}/videos/generated/video/t2v/video_1.mp4`;
  const foreign = "other-user/videos/generated/video/t2v/video_1.mp4";
  const suffix = "videos/generated/video/t2v/video_1.mp4";
  const signedOwned = `https://example.supabase.co/storage/v1/object/sign/krakatoa/${owned}?token=abc`;

  assert(pathPrefixOwnedByUser(owned, userId), "user-first path must be prefix-owned");
  assert(
    pathPrefixOwnedByUser(`photos/${userId}/generated/product/z.png`, userId),
    "legacy photos/{userId}/ path must be prefix-owned",
  );
  assert(!pathPrefixOwnedByUser(foreign, userId), "another user's prefix must not be owned");
  assert(
    !pathPrefixOwnedByUser(suffix, userId),
    "a user-less suffix path must not be prefix-owned",
  );

  assert(storedValueReferencesPath(owned, owned), "exact storage_path must match");
  assert(
    storedValueReferencesPath(signedOwned, owned),
    "a signed URL must reference the path it actually points at",
  );
  assert(
    !storedValueReferencesPath(signedOwned, suffix),
    "a signed URL must not grant a different suffix key",
  );
  assert(
    !storedValueReferencesPath(signedOwned, foreign),
    "a signed URL must not grant another user's path",
  );
  assert(!storedValueReferencesPath("", owned), "empty stored value must not match");
}

storageSignOwnershipSelfCheck();
console.log("storage-sign-ownership self-check passed");
