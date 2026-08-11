import type { NextRequest } from "next/server";

export const ADMIN_PAGE_SIZE = 10;

const MAX_LIMIT = 100;

/**
 * Parse `limit` / `offset` for paginated admin endpoints.
 *
 * Clamps rather than rejecting: a malformed page param should show the first
 * page, not 400 an admin out of their own dashboard. limit is capped so a
 * hand-edited URL cannot ask for the whole table.
 */
export function readPageParams(req: NextRequest): {
  limit: number;
  offset: number;
} {
  const params = req.nextUrl.searchParams;

  const rawLimit = Number(params.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : ADMIN_PAGE_SIZE;

  const rawOffset = Number(params.get("offset"));
  const offset =
    Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  return { limit, offset };
}
