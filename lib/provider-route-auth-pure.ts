/**
 * Shared unauthenticated outcome for service-role provider routes.
 * Pure — no Supabase, no Next.js.
 */

export function unauthenticatedProviderHttp(): { status: 401; error: string } {
  return { status: 401, error: "Not authenticated." };
}

export function requireResolvedSessionUserId(userId: string | null): string {
  if (!userId) {
    throw new Error(unauthenticatedProviderHttp().error);
  }
  return userId;
}
