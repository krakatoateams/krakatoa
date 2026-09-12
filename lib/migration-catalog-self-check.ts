import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`migration-catalog self-check: ${message}`);
}

export function migrationCatalogSelfCheck(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const migrations = join(root, "supabase/migrations");

  assert(
    !existsSync(join(migrations, "076_tool_preview_access 2.sql")),
    "duplicate 076_tool_preview_access 2.sql must not remain in the catalog",
  );

  const early = ["002_user_creations.sql", "003_platform_foundation_nextauth_single_user.sql"];
  for (const file of early) {
    const sql = readFileSync(join(migrations, file), "utf8");
    assert(
      !/references users\s*\(/i.test(sql),
      `${file} must not declare FK targets on public.users`,
    );
    assert(
      /references auth\.users/i.test(sql),
      `${file} must declare identity FKs against auth.users`,
    );
  }

  const drop = readFileSync(join(migrations, "094_drop_legacy_credit_rpc_overload.sql"), "utf8");
  assert(
    /drop function if exists public\.krakatoa_apply_credit_transaction\(/i.test(drop),
    "094 must drop the leftover 10-arg credit RPC overload",
  );

  const names = readdirSync(migrations).filter((name) => name.endsWith(".sql"));
  assert(
    names.every((name) => !name.includes(" ")),
    "migration filenames must not contain spaces",
  );
}

migrationCatalogSelfCheck();
console.log("migration-catalog self-check passed");
