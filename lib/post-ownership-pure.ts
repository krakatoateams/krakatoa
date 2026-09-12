/**
 * Owner check for user post mutations. Pure — no Supabase.
 * Wrong-owner stays 403 (the route already fetched the row).
 */

export function postOwnerDenied(
  existingProfileId: string | null | undefined,
  sessionProfileId: string,
): { status: 403; error: string } | null {
  if (existingProfileId !== sessionProfileId) {
    return { status: 403, error: "Forbidden." };
  }
  return null;
}
