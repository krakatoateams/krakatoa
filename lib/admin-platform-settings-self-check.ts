import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  creditPacksFromApiPayload,
  creditPacksFromDbRows,
} from "./credit-packs";
import {
  MAX_WELCOME_BONUS_CREDITS,
  normalizeWelcomeBonusCreditAmount,
  parseWelcomeBonusCreditAmount,
} from "./welcome-bonus-validation";
import { isWelcomeVideoOfferEligible } from "./welcome-video-offer-pure";

assert.deepEqual(
  creditPacksFromDbRows([]),
  [],
  "an explicit empty active-pack set must disable checkout"
);
assert.deepEqual(
  creditPacksFromDbRows(null),
  [],
  "a failed DB read must hide stale pack defaults"
);
assert.deepEqual(
  creditPacksFromApiPayload({ packs: [] }),
  [],
  "clients must accept an explicit empty pack response"
);
assert.equal(creditPacksFromApiPayload({}), null);

assert.equal(
  isWelcomeVideoOfferEligible({
    enabled: true,
    creditAmount: 0,
    hasJobs: false,
    hasClaimed: false,
  }),
  false,
  "a zero-credit offer must not be advertised as claimable"
);
assert.equal(
  isWelcomeVideoOfferEligible({
    enabled: true,
    creditAmount: 10,
    hasJobs: false,
    hasClaimed: false,
  }),
  true
);

assert.deepEqual(parseWelcomeBonusCreditAmount(MAX_WELCOME_BONUS_CREDITS), {
  ok: true,
  value: MAX_WELCOME_BONUS_CREDITS,
});
assert.equal(
  parseWelcomeBonusCreditAmount(MAX_WELCOME_BONUS_CREDITS + 1).ok,
  false,
  "welcome grants must have a bounded blast radius"
);
assert.equal(
  normalizeWelcomeBonusCreditAmount(MAX_WELCOME_BONUS_CREDITS + 1),
  0,
  "out-of-policy DB values must not reach the claim path"
);

const packsDbSource = readFileSync(
  new URL("./credit-packs-db.ts", import.meta.url),
  "utf8"
);
assert.match(
  packsDbSource,
  /\.rpc\(REPLACE_CREDIT_PACKS_RPC/,
  "full-set pack replacement must use one transactional RPC"
);
assert.doesNotMatch(
  packsDbSource,
  /\.delete\(\)\.not\("id", "in"/,
  "pack replacement must not delete before a separate upsert"
);
assert.doesNotMatch(
  packsDbSource,
  /getActiveCreditPack[\s\S]*?listActiveCreditPacks\(\)/,
  "checkout pack resolution must not inherit the fail-open display fallback"
);

for (const relativePath of [
  "./use-credit-packs.ts",
  "../app/(app)/dashboard/settings/CreditsTab.tsx",
]) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  assert.match(
    source,
    /creditPacksFromApiPayload/,
    `${relativePath} must honor an explicit empty API pack set`
  );
  assert.match(
    source,
    /setPacks\(next \?\? \[\]\)/,
    `${relativePath} must fail closed on a malformed success payload`
  );
}

const welcomeOfferSource = readFileSync(
  new URL("./welcome-video-offer.ts", import.meta.url),
  "utf8"
);
assert.match(
  welcomeOfferSource,
  /seed:welcome_bonus:/,
  "legacy automatic welcome grants must block a second on-demand claim"
);

console.log("admin platform settings self-check passed");
