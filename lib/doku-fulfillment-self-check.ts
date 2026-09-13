import { readFileSync } from "node:fs";
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

  const script = readFileSync(
    new URL("../scripts/reconcile-doku-orders.mjs", import.meta.url),
    "utf8",
  );
  assert(
    /dokuPaidAmountMatchesOrder/.test(script),
    "one-off reconcile must fail closed with dokuPaidAmountMatchesOrder",
  );
  assert(
    /purchase:doku:\$\{[^}]+\}:base/.test(script),
    "one-off reconcile must bind the live :base purchase key",
  );
  assert(
    /purchase:doku:\$\{[^}]+\}:bonus/.test(script),
    "one-off reconcile must bind the live :bonus purchase key",
  );
  assert(
    !/p_idempotency_key: `purchase:doku:\$\{o\.invoice_number\}`/.test(script),
    "one-off reconcile must not fulfill on a single loose purchase key",
  );
}

dokuFulfillmentSelfCheck();
console.log("doku-fulfillment self-check passed");
