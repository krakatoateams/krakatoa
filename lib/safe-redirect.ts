/**
 * Only ever allow a same-origin relative path as a redirect target coming
 * from user input (a `next`/`redirectTo`-style query param).
 *
 * Requiring a single leading "/" is what actually makes this safe, not just
 * prepending our own origin before it — e.g. `origin + "@evil.com"` parses
 * as `http://ourorigin@evil.com` (a valid URL where "ourorigin" is treated
 * as userinfo and "evil.com" is the real host), and `origin + "//evil.com"`
 * without this check would be the classic protocol-relative bypass. A
 * leading "/" forces any later "@" into path position instead of authority
 * position, and rejecting a second leading "/" blocks protocol-relative.
 */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return "/dashboard";
}
