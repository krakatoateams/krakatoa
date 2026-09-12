import {
  photoProxyStorageCandidates,
  photoStoragePathToProxyRest,
} from "./storage-buckets";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`tiktok-photo-proxy self-check: ${message}`);
}

export function tiktokPhotoProxySelfCheck(): void {
  const uid = "abc-123-def";
  const rest = "generated/product/z.png";
  const userFirst = `${uid}/photos/${rest}`;
  const legacy = `photos/${uid}/${rest}`;
  const proxyRest = photoStoragePathToProxyRest(legacy);
  assert(proxyRest === `${uid}/${rest}`, "legacy photo path must map to {userId}/rest");

  const keys = photoProxyStorageCandidates(proxyRest!.split("/"));
  assert(keys.includes(userFirst), "proxy must try the user-first photo key");
  assert(
    keys.includes(legacy),
    "proxy must also try the advertised legacy photos/{userId}/ key",
  );
  assert(
    keys.every((key) => key.startsWith("photos/") || key.includes("/photos/")),
    "every candidate must stay under a photos/ segment",
  );
  assert(
    !keys.some((key) => key.startsWith("videos/") || key.includes("/videos/")),
    "candidates must never reconstruct a videos/ key",
  );

  const profiles = photoProxyStorageCandidates(["profiles", "id", "x.png"]);
  assert(
    profiles.every((key) => key.startsWith("photos/")),
    "a profiles/ first segment must fall back under photos/, not profiles/",
  );
}

tiktokPhotoProxySelfCheck();
console.log("tiktok-photo-proxy self-check passed");
