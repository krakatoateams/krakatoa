const REPLICATE_DELIVERY_HOST = "replicate.delivery";

export function isTrustedReplicateOutputUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === REPLICATE_DELIVERY_HOST ||
        url.hostname.endsWith(`.${REPLICATE_DELIVERY_HOST}`))
    );
  } catch {
    return false;
  }
}

export function assertTrustedReplicateOutputUrl(value: string): void {
  if (!isTrustedReplicateOutputUrl(value)) {
    throw new Error("Replicate returned an untrusted output URL.");
  }
}
