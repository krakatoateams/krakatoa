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
assert.match(
  welcomeOfferSource,
  /krakatoa_claim_welcome_video_offer/,
  "welcome claim must go through the atomic eligibility+grant RPC"
);
assert.doesNotMatch(
  welcomeOfferSource,
  /addBonusCredits/,
  "welcome claim must not grant after a separate JS eligibility read"
);

const welcomeClaimRoute = readFileSync(
  new URL("../app/api/welcome-video-offer/claim/route.ts", import.meta.url),
  "utf8"
);
assert.match(
  welcomeClaimRoute,
  /claimWelcomeVideoOffer/,
  "claim route must call the atomic welcome-claim helper"
);
assert.doesNotMatch(
  welcomeClaimRoute,
  /addBonusCredits/,
  "claim route must not grant credits outside the atomic RPC"
);

const welcomeClaimSql = readFileSync(
  new URL("../supabase/migrations/097_atomic_welcome_video_claim.sql", import.meta.url),
  "utf8"
);
assert.match(
  welcomeClaimSql,
  /before insert on public\.jobs/i,
  "job inserts must take the same profile row lock as welcome claim"
);
assert.match(
  welcomeClaimSql,
  /for update/i,
  "claim RPC must lock the profile row"
);
assert.match(
  welcomeClaimSql,
  /from public\.jobs/i,
  "claim RPC must re-check first-job eligibility in the same transaction"
);
assert.match(
  welcomeClaimSql,
  /bonus:welcome_video_claim:/,
  "claim RPC must honor the on-demand idempotency key"
);
assert.match(
  welcomeClaimSql,
  /seed:welcome_bonus:/,
  "claim RPC must honor the legacy auto-grant key"
);
assert.match(
  welcomeClaimSql,
  /krakatoa_apply_credit_transaction/,
  "claim RPC must grant through the ledger RPC"
);
assert.match(
  welcomeClaimSql,
  /to service_role/,
  "claim RPC must stay service-role-only"
);

console.log("admin platform settings self-check passed");
