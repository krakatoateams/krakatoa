import {
  AdminNotFoundError,
  LastAdminError,
  NotAdminError,
  NotAuthenticatedError,
  classifyAdminError,
  interpretRevokeAdminResult,
} from "./admin-auth-pure";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`admin-auth self-check: ${message}`);
}

export function adminAuthSelfCheck(): void {
  assert(
    classifyAdminError(new NotAuthenticatedError()).status === 401,
    "unauthenticated admin API callers must get 401",
  );
  assert(
    classifyAdminError(new NotAdminError()).status === 403,
    "authenticated non-admins must get 403",
  );
  assert(
    classifyAdminError(new LastAdminError()).status === 409,
    "revoking the last active admin must get 409",
  );
  assert(
    classifyAdminError(new AdminNotFoundError()).status === 404,
    "revoking an unknown admin id must get 404, not 500",
  );
  assert(
    classifyAdminError(new Error("Not authenticated.")).status === 401,
    "legacy profile-resolver auth errors must stay 401",
  );
  assert(
    classifyAdminError(new Error("boom")).status === 500,
    "infra failures must stay 500",
  );

  try {
    interpretRevokeAdminResult({ action: "not_found" });
    throw new Error("admin-auth self-check: missing admin must throw");
  } catch (e) {
    assert(
      e instanceof AdminNotFoundError,
      "RPC not_found must become AdminNotFoundError",
    );
  }

  try {
    interpretRevokeAdminResult({ action: "last_admin" });
    throw new Error("admin-auth self-check: last admin must throw");
  } catch (e) {
    assert(
      e instanceof LastAdminError,
      "RPC last_admin must become LastAdminError",
    );
  }

  const revoked = interpretRevokeAdminResult({
    action: "revoked",
    admin: { id: "admin-1" },
  });
  assert(revoked.id === "admin-1", "RPC revoked must return the admin row");
}

adminAuthSelfCheck();
console.log("admin-auth self-check passed");
