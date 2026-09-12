/**
 * Amount binding for DOKU SUCCESS before wallet credit. Pure — no network.
 * A missing or non-finite amount is fail-closed (same as webhook).
 */

export function dokuPaidAmountMatchesOrder(
  paidAmount: number | null,
  expectedAmount: number,
): boolean {
  return (
    paidAmount !== null &&
    Number.isFinite(paidAmount) &&
    paidAmount === expectedAmount
  );
}
