import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`rpc-grant-lockdown self-check: ${message}`);
}

/** Functions confirmed callable by anon/authenticated on the live project. */
export const LIVE_OPEN_KRAKATOA_RPCS = [
  "krakatoa_apply_credit_transaction",
  "krakatoa_expire_credit_lots",
  "krakatoa_seed_initial_credits",
  "krakatoa_set_updated_at",
] as const;

export function rpcGrantSqlLocksAllKrakatoaFunctions(sql: string): boolean {
  return (
    /proname like 'krakatoa_%'/.test(sql) &&
    /revoke all on function/i.test(sql) &&
    /from public, anon, authenticated/i.test(sql) &&
    /grant execute on function/i.test(sql) &&
    /to service_role/i.test(sql) &&
    !/revoke execute on function public\.krakatoa_admin_/.test(sql)
  );
}

export function rpcGrantLockdownSelfCheck(): void {
  const broken = `
revoke execute on function public.krakatoa_apply_credit_transaction from anon, authenticated;
`;
  assert(
    !rpcGrantSqlLocksAllKrakatoaFunctions(broken),
    "revoking only anon/authenticated must not count as lockdown",
  );

  const migration = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../supabase/migrations/092_krakatoa_rpc_grants.sql",
    ),
    "utf8",
  );
  assert(
    rpcGrantSqlLocksAllKrakatoaFunctions(migration),
    "092 must revoke PUBLIC on every public.krakatoa_* function and grant service_role",
  );
  for (const name of LIVE_OPEN_KRAKATOA_RPCS) {
    assert(
      migration.includes("krakatoa_%") || migration.includes(name),
      `092 must cover ${name}`,
    );
  }
}

rpcGrantLockdownSelfCheck();
console.log("rpc-grant-lockdown self-check passed");
