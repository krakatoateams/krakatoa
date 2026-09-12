/**
 * NextAuth `users` → `auth.users` identity FK cutover plan.
 *
 * Production already points every live `user_id` FK at `auth.users`. This
 * module is the contract for the idempotent migration that records that
 * state: never rematch IDs by email, fail closed on orphans, and leave
 * aligned databases untouched.
 */

export type AuthUsersFkTable =
  | "profiles"
  | "user_creations"
  | "platform_tokens"
  | "posts"
  | "storyboards"
  | "product_photo_generations";

export type OnDeleteAction = "CASCADE" | "SET NULL";

export type AuthUsersFkTarget = {
  table: AuthUsersFkTable;
  constraint: string;
  onDelete: OnDeleteAction;
};

export const AUTH_USERS_FK_TARGETS: readonly AuthUsersFkTarget[] = [
  { table: "profiles", constraint: "profiles_user_id_fkey", onDelete: "CASCADE" },
  {
    table: "user_creations",
    constraint: "user_creations_user_id_fkey",
    onDelete: "CASCADE",
  },
  {
    table: "platform_tokens",
    constraint: "platform_tokens_user_id_fkey",
    onDelete: "CASCADE",
  },
  { table: "posts", constraint: "posts_user_id_fkey", onDelete: "CASCADE" },
  {
    table: "storyboards",
    constraint: "storyboards_user_id_fkey",
    onDelete: "SET NULL",
  },
  {
    table: "product_photo_generations",
    constraint: "product_photo_generations_user_id_fkey",
    onDelete: "CASCADE",
  },
];

export type ObservedUserIdFk = {
  table: AuthUsersFkTable;
  exists: boolean;
  referencedSchema: string | null;
  referencedTable: string | null;
  orphanCount: number;
};

export type UsersRenameState = {
  usersExists: boolean;
  usersDeprecatedExists: boolean;
};

export type FkCutoverDecision =
  | { kind: "skip_missing_table"; table: AuthUsersFkTable }
  | { kind: "skip_already_auth_users"; table: AuthUsersFkTable }
  | {
      kind: "retarget";
      table: AuthUsersFkTable;
      constraint: string;
      onDelete: OnDeleteAction;
    };

export type RenameDecision =
  | { kind: "rename_users_to_deprecated" }
  | { kind: "skip_rename"; reason: "already_renamed" | "users_absent" };

export type AuthUsersFkCutoverPlan = {
  blocked: boolean;
  fk: FkCutoverDecision[];
  rename: RenameDecision;
};

export class AuthUsersFkOrphansError extends Error {
  readonly code = "AUTH_USERS_FK_ORPHANS";
  constructor(public readonly tables: { table: AuthUsersFkTable; orphanCount: number }[]) {
    super(
      `auth_users_fk_cutover: orphan user_id values remain: ${tables
        .map((row) => `${row.table}=${row.orphanCount}`)
        .join(" ")}`,
    );
    this.name = "AuthUsersFkOrphansError";
  }
}

function alreadyAuthUsers(row: ObservedUserIdFk): boolean {
  return row.referencedSchema === "auth" && row.referencedTable === "users";
}

export function planAuthUsersFkCutover(
  observed: ObservedUserIdFk[],
  rename: UsersRenameState,
): AuthUsersFkCutoverPlan {
  const byTable = new Map(observed.map((row) => [row.table, row]));
  const orphans: { table: AuthUsersFkTable; orphanCount: number }[] = [];
  const fk: FkCutoverDecision[] = [];

  for (const target of AUTH_USERS_FK_TARGETS) {
    const row = byTable.get(target.table);
    if (!row || !row.exists) {
      fk.push({ kind: "skip_missing_table", table: target.table });
      continue;
    }
    if (row.orphanCount > 0) {
      orphans.push({ table: target.table, orphanCount: row.orphanCount });
      continue;
    }
    if (alreadyAuthUsers(row)) {
      fk.push({ kind: "skip_already_auth_users", table: target.table });
      continue;
    }
    fk.push({
      kind: "retarget",
      table: target.table,
      constraint: target.constraint,
      onDelete: target.onDelete,
    });
  }

  if (orphans.length > 0) {
    throw new AuthUsersFkOrphansError(orphans);
  }

  let renameDecision: RenameDecision;
  if (rename.usersDeprecatedExists) {
    renameDecision = { kind: "skip_rename", reason: "already_renamed" };
  } else if (!rename.usersExists) {
    renameDecision = { kind: "skip_rename", reason: "users_absent" };
  } else {
    renameDecision = { kind: "rename_users_to_deprecated" };
  }

  return { blocked: false, fk, rename: renameDecision };
}
