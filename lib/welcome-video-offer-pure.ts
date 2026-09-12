export function isWelcomeVideoOfferEligible(input: {
  enabled: boolean;
  creditAmount: number;
  hasJobs: boolean;
  hasClaimed: boolean;
}): boolean {
  return (
    input.enabled &&
    input.creditAmount > 0 &&
    !input.hasJobs &&
    !input.hasClaimed
  );
}
