/** When balance is unknown (loading / fetch failed), do not block — server enforces. */
export function isCreditBalanceSufficient(
  balance: number | null,
  cost: number
): boolean {
  return balance === null || balance >= cost;
}

export function insufficientCreditsTooltip(
  balance: number | null,
  cost: number
): string | null {
  if (balance === null || balance >= cost) return null;
  const shortfall = cost - balance;
  const creditWord = shortfall === 1 ? "credit" : "credits";
  return `Need ${shortfall} more ${creditWord} (${balance} available, ${cost} required)`;
}
