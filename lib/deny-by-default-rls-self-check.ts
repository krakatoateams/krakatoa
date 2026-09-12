import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`deny-by-default-rls self-check: ${message}`);
}

/** Policies that exist live and violate deny-by-default. */
export const UNTRACKED_OPEN_POLICIES = [
  { table: "storyboards", name: "anon can read storyboards" },
  { table: "posts", name: "posts: own rows" },
  { table: "platform_tokens", name: "platform_tokens: own rows" },
  { table: "users_deprecated", name: "users: own row" },
] as const;

export function denyByDefaultRlsSelfCheck(): void {
  const migration = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../supabase/migrations/093_deny_by_default_legacy_policies.sql",
    ),
    "utf8",
  );

  assert(
    !/create policy/i.test(migration),
    "093 must drop leftover policies, not add new ones",
  );
  for (const policy of UNTRACKED_OPEN_POLICIES) {
    assert(
      migration.includes(`drop policy if exists "${policy.name}" on public.${policy.table}`),
      `093 must drop ${policy.table}.${policy.name}`,
    );
  }
  assert(
    /revoke all on function public\.rls_auto_enable\(\) from public, anon, authenticated/i.test(
      migration,
    ),
    "093 must revoke PUBLIC execute on rls_auto_enable",
  );
}

denyByDefaultRlsSelfCheck();
console.log("deny-by-default-rls self-check passed");
