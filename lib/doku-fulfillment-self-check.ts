import { dokuPaidAmountMatchesOrder } from "./doku-fulfillment-pure";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`doku-fulfillment self-check: ${message}`);
}

export function dokuFulfillmentSelfCheck(): void {
  assert(
    dokuPaidAmountMatchesOrder(15000, 15000),
    "matching paid amount must fulfill",
  );
  assert(
    !dokuPaidAmountMatchesOrder(1, 15000),
    "wrong paid amount must not fulfill",
  );
  assert(
    !dokuPaidAmountMatchesOrder(null, 15000),
    "a missing DOKU amount must not fulfill",
  );
}

dokuFulfillmentSelfCheck();
console.log("doku-fulfillment self-check passed");
