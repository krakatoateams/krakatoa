import { readFileSync } from "node:fs";
import { cronAuthDecision } from "./cron-auth-pure";

const CRON_ROUTES = [
  "app/api/cron/route.ts",
  "app/api/cron/storage-sweep/route.ts",
  "app/api/cron/credit-expiry/route.ts",
  "app/api/cron/creation-expiry/route.ts",
  "app/api/cron/cleanup-failed-posts/route.ts",
  "app/api/cron/generation-reconcile/route.ts",
  "app/api/cron/instagram-token-refresh/route.ts",
] as const;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`cron-auth self-check: ${message}`);
}

export function cronAuthSelfCheck(): void {
  assert(
    cronAuthDecision({
      authorization: null,
      secret: undefined,
      deployed: false,
    }) === "allow",
    "local development may run cron routes without a secret",
  );
  assert(
    cronAuthDecision({
      authorization: null,
      secret: undefined,
      deployed: true,
    }) === "misconfigured",
    "deployed cron routes must fail closed when CRON_SECRET is missing",
  );
  assert(
    cronAuthDecision({
      authorization: "Bearer expected-secret",
      secret: "expected-secret",
      deployed: true,
    }) === "allow",
    "a deployed cron request with the configured bearer must pass",
  );
  assert(
    cronAuthDecision({
      authorization: "Bearer wrong-secret",
      secret: "expected-secret",
      deployed: true,
    }) === "unauthorized",
    "a wrong deployed bearer must be rejected",
  );

  for (const route of CRON_ROUTES) {
    const source = readFileSync(new URL(`../${route}`, import.meta.url), "utf8");
    assert(
      source.includes("cronAuthorizationFailure(req)"),
      `${route} must use the shared cron authorization guard`,
    );
    assert(
      !source.includes("process.env.CRON_SECRET"),
      `${route} must not reimplement the shared secret policy`,
    );
  }
}

cronAuthSelfCheck();
console.log("cron-auth self-check passed");
