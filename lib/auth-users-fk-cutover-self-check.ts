import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTH_USERS_FK_TARGETS,
  AuthUsersFkOrphansError,
  planAuthUsersFkCutover,
  type ObservedUserIdFk,
} from "./auth-users-fk-cutover-pure";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`auth-users-fk-cutover self-check: ${message}`);
}

function observed(
  table: ObservedUserIdFk["table"],
  overrides: Partial<ObservedUserIdFk> = {},
): ObservedUserIdFk {
  return {
    table,
    exists: true,
    referencedSchema: "auth",
    referencedTable: "users",
    orphanCount: 0,
    ...overrides,
  };
}

function productionShaped(): ObservedUserIdFk[] {
  return AUTH_USERS_FK_TARGETS.map((target) =>
    observed(target.table, {
      exists: target.table !== "product_photo_generations",
    }),
  );
}

export function authUsersFkCutoverSelfCheck(): void {
  const posts = AUTH_USERS_FK_TARGETS.find((t) => t.table === "posts");
  assert(!!posts, "posts must be in the formal cutover set");
  assert(
    posts?.onDelete === "CASCADE",
    "posts.user_id must keep live ON DELETE CASCADE, not the deferred script SET NULL",
  );

  const storyboards = AUTH_USERS_FK_TARGETS.find((t) => t.table === "storyboards");
  assert(
    storyboards?.onDelete === "SET NULL",
    "storyboards.user_id must keep live ON DELETE SET NULL",
  );

  const production = planAuthUsersFkCutover(productionShaped(), {
    usersExists: false,
    usersDeprecatedExists: true,
  });
  assert(!production.blocked, "aligned production must not be blocked");
  assert(
    production.fk.every((d) => d.kind === "skip_already_auth_users" || d.kind === "skip_missing_table"),
    "aligned production FKs must be a no-op",
  );
  assert(
    production.fk.some(
      (d) => d.kind === "skip_missing_table" && d.table === "product_photo_generations",
    ),
    "absent product_photo_generations must not be created",
  );
  assert(
    production.rename.kind === "skip_rename" && production.rename.reason === "already_renamed",
    "users_deprecated must not be renamed again",
  );

  const precutover = AUTH_USERS_FK_TARGETS.map((target) =>
    observed(target.table, {
      referencedSchema: "public",
      referencedTable: "users",
    }),
  );
  const ready = planAuthUsersFkCutover(precutover, {
    usersExists: true,
    usersDeprecatedExists: false,
  });
  assert(!ready.blocked, "orphan-free pre-cutover must proceed");
  assert(
    ready.fk.every((d) => d.kind === "retarget"),
    "orphan-free FKs still pointing at public.users must retarget",
  );
  assert(
    ready.rename.kind === "rename_users_to_deprecated",
    "public.users must rename only when users_deprecated is absent",
  );

  try {
    planAuthUsersFkCutover(
      AUTH_USERS_FK_TARGETS.map((target) =>
        observed(target.table, {
          referencedSchema: "public",
          referencedTable: "users",
          orphanCount: target.table === "posts" ? 2 : 0,
        }),
      ),
      { usersExists: true, usersDeprecatedExists: false },
    );
    throw new Error("auth-users-fk-cutover self-check: orphans must refuse");
  } catch (error) {
    if (!(error instanceof AuthUsersFkOrphansError)) {
      throw error;
    }
    assert(error.tables[0]?.table === "posts", "orphan report must name posts");
    assert(error.tables[0]?.orphanCount === 2, "orphan report must keep the count");
  }

  try {
    planAuthUsersFkCutover(
      productionShaped().map((row) =>
        row.table === "profiles" ? { ...row, orphanCount: 1 } : row,
      ),
      { usersExists: false, usersDeprecatedExists: true },
    );
    throw new Error("auth-users-fk-cutover self-check: auth-aligned orphans must refuse");
  } catch (error) {
    if (!(error instanceof AuthUsersFkOrphansError)) {
      throw error;
    }
    assert(
      error.tables[0]?.table === "profiles",
      "already-auth FKs must still fail closed on orphans",
    );
  }

  const migration = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/091_auth_users_fk_cutover.sql"),
    "utf8",
  );
  assert(
    !/lower\s*\(.*email/i.test(migration),
    "091 must not rematch user_id by email",
  );
  assert(
    !/drop table .*users_deprecated/i.test(migration),
    "091 must keep users_deprecated",
  );
  assert(
    /posts_user_id_fkey',\s*'CASCADE'/.test(migration),
    "091 must record posts ON DELETE CASCADE",
  );
  assert(
    /storyboards_user_id_fkey',\s*'SET NULL'/.test(migration),
    "091 must record storyboards ON DELETE SET NULL",
  );

  const superseded = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../scripts/migrations/001-remap-users-to-supabase-auth.sql",
    ),
    "utf8",
  );
  assert(
    /raise exception/i.test(superseded),
    "deferred remap script must refuse to run",
  );
  assert(
    !/lower\s*\(.*email/i.test(superseded),
    "deferred remap script must not keep email rematch SQL",
  );
}

authUsersFkCutoverSelfCheck();
console.log("auth-users-fk-cutover self-check passed");
